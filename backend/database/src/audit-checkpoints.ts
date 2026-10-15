import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { type ChainReport, type ChainStart, eventHashHolds, verifyAuditChain } from './audit.ts';
import { auditKeyring } from './audit-keys.ts';
import type { Executor } from './index.ts';
import { auditCheckpoints, auditEvents } from './schema.ts';

/**
 * Incremental verification.
 *
 * Walking a whole chain hashes every event, which grows without bound. After
 * a clean check the head is stored as a checkpoint, and the next check walks
 * only the events after it. A checkpoint is signed with the audit key, so
 * one moved or invented in the database is rejected rather than trusted;
 * the check then walks everything, as a full check always does.
 *
 * Starting from a checkpoint also checks two things a full walk would:
 * that the event at the checkpoint still has the hash it had, and that the
 * chain has not become shorter than the checkpoint.
 */

/**
 * How a check began: from no checkpoint, from a trusted one, from one whose
 * signature failed (`rejected`), or from one whose event has changed since
 * (`stale`). The last two both mean the whole chain was walked.
 */
export type CheckpointUse = 'none' | 'used' | 'rejected' | 'stale';

export type VerifyResult = ChainReport & { checkpoint: CheckpointUse };

function macOf(workspaceId: string, point: ChainStart, keyId: string): string | null {
  const secret = auditKeyring().keys.get(keyId);
  if (!secret) return null;
  const text = ['checkpoint', workspaceId, String(point.seq), point.hash, String(point.signed)];
  return createHmac('sha256', secret).update(text.join('\x1f'), 'utf8').digest('hex');
}

function sameMac(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The stored checkpoint, if there is one and its signature holds. */
async function trustedCheckpoint(
  db: Executor,
  workspaceId: string,
): Promise<{ point: ChainStart | null; use: CheckpointUse }> {
  const [row] = await db
    .select()
    .from(auditCheckpoints)
    .where(eq(auditCheckpoints.workspaceId, workspaceId));
  if (!row) return { point: null, use: 'none' };

  const point = { seq: row.seq, hash: row.hash, signed: row.signed };
  const expected = macOf(workspaceId, point, row.keyId);
  if (!expected || !sameMac(expected, row.mac)) return { point: null, use: 'rejected' };
  return { point, use: 'used' };
}

/**
 * Whether the event a checkpoint names is still there, unchanged: the same
 * hash as when it was checked, and contents that still hash to it. The walk
 * starts after this event, so this is the one place it is looked at.
 */
async function checkpointHolds(db: Executor, workspaceId: string, point: ChainStart) {
  const [event] = await db
    .select()
    .from(auditEvents)
    .where(sql`${auditEvents.workspaceId} = ${workspaceId} and ${auditEvents.seq} = ${point.seq}`);
  return event !== undefined && event.hash === point.hash && eventHashHolds(event);
}

async function storeCheckpoint(
  db: Executor,
  workspaceId: string,
  report: ChainReport,
  signed: boolean,
) {
  if (!report.ok || !report.head) return;
  const keyId = auditKeyring().currentId;
  const point = { seq: report.head.seq, hash: report.head.hash, signed };
  const mac = macOf(workspaceId, point, keyId)!;
  const values = { workspaceId, ...point, keyId, mac, verifiedAt: new Date() };
  await db
    .insert(auditCheckpoints)
    .values(values)
    // Never backwards: of two checks finishing out of order, the one that
    // reached further keeps its place. The table refuses a step back anyway.
    .onConflictDoUpdate({
      target: auditCheckpoints.workspaceId,
      set: values,
      setWhere: sql`${auditCheckpoints.seq} <= excluded.seq`,
    });
}

/** Whether the chain up to its head holds any signed event. */
async function anySigned(db: Executor, workspaceId: string, upTo: number): Promise<boolean> {
  const [row] = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(
      sql`${auditEvents.workspaceId} = ${workspaceId} and ${auditEvents.seq} <= ${upTo} and ${auditEvents.keyId} is not null`,
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Verify a workspace's chain, from its checkpoint unless `full` is asked for,
 * and move the checkpoint to the head when the check is clean.
 */
export async function verifyAuditTrail(
  db: Executor,
  workspaceId: string,
  options: { full?: boolean } = {},
): Promise<VerifyResult> {
  let trusted: { point: ChainStart | null; use: CheckpointUse } = options.full
    ? { point: null, use: 'none' }
    : await trustedCheckpoint(db, workspaceId);

  // A chain now ending before the checkpoint lost its newest events. Asked
  // first: the signed checkpoint is evidence of how far the chain reached,
  // even when the event it names is among those removed.
  if (trusted.point) {
    const [last] = await db
      .select({ seq: sql<number>`coalesce(max(${auditEvents.seq}), 0)::int` })
      .from(auditEvents)
      .where(eq(auditEvents.workspaceId, workspaceId));
    const end = last?.seq ?? 0;
    if (end < trusted.point.seq) {
      return {
        ok: false,
        checked: 0,
        fromSeq: trusted.point.seq,
        head: null,
        checkpoint: 'used',
        broken: {
          seq: end + 1,
          eventId: null,
          reason: 'truncated',
          detail: `The trail ends at event ${end}, but it was verified up to ${trusted.point.seq}: newer events were removed.`,
        },
      };
    }
    // The event it names was changed: walk everything, which will say where.
    if (!(await checkpointHolds(db, workspaceId, trusted.point))) {
      trusted = { point: null, use: 'stale' };
    }
  }

  const report = await verifyAuditChain(db, workspaceId, trusted.point ?? undefined);
  if (report.ok && report.head) {
    const signed = await anySigned(db, workspaceId, report.head.seq);
    await storeCheckpoint(db, workspaceId, report, signed);
  }
  return { ...report, checkpoint: trusted.use };
}
