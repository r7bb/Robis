import { sql } from 'drizzle-orm';
import { lockAuditChain, recordAudit, verifyAuditChain } from './audit.ts';
import { auditKeyring } from './audit-keys.ts';
import type { Database } from './index.ts';
import { auditEvents, workspaces } from './schema.ts';

/**
 * Sealing the chains written before signing existed: `bun run audit:seal`,
 * once, when upgrading.
 *
 * A seal is one signed `audit.keyed` event appended to a chain whose events
 * are all unsigned. From then on the chain carries a signature, which is
 * what lets verification treat a chain with none as rewritten.
 *
 * It is a deliberate one-off step, never run at startup. Run automatically,
 * it would also seal a chain that someone had rewritten without the key,
 * which looks exactly like an old one, and turn that rewrite into a chain
 * that verifies. So it is run once, after every server writes signed events
 * and before anyone has had a reason to tamper, and it refuses any chain
 * that is broken in any other way or already holds a signed event.
 */

export type SealOutcome =
  | { workspaceId: string; outcome: 'sealed' }
  | { workspaceId: string; outcome: 'skipped'; reason: string }
  | { workspaceId: string; outcome: 'failed'; error: string };

/** Workspaces whose newest event is unsigned: the only ones worth looking at. */
async function candidates(db: Database): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    select w.id from ${workspaces} w
    where (
      select a.key_id is null from ${auditEvents} a
      where a.workspace_id = w.id
      order by a.seq desc
      limit 1
    )
    order by w.id
  `);
  return rows.map((row) => row.id);
}

async function sealOne(db: Database, workspaceId: string): Promise<SealOutcome> {
  return db.transaction(async (tx) => {
    // Checked again under the chain's lock, so two runs at once (or a
    // writer in between) cannot seal one chain twice.
    await lockAuditChain(tx, workspaceId);
    const report = await verifyAuditChain(tx, workspaceId);

    // An old chain fails exactly one way: it has no signature yet.
    if (report.broken?.reason !== 'unsigned') {
      return {
        workspaceId,
        outcome: 'skipped',
        reason: report.ok ? 'already signed' : `not sealed: ${report.broken!.detail}`,
      };
    }

    await recordAudit(
      tx,
      { id: null, kind: 'system' },
      {
        workspaceId,
        entityType: 'workspace',
        entityId: workspaceId,
        eventType: 'audit.keyed',
        payload: { keyId: auditKeyring().currentId, sealedSeq: report.head!.seq },
      },
    );
    return { workspaceId, outcome: 'sealed' };
  });
}

/** Seal every eligible chain. One workspace failing does not stop the rest. */
export async function sealLegacyChains(db: Database): Promise<SealOutcome[]> {
  const outcomes: SealOutcome[] = [];
  for (const workspaceId of await candidates(db)) {
    try {
      outcomes.push(await sealOne(db, workspaceId));
    } catch (error) {
      outcomes.push({
        workspaceId,
        outcome: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return outcomes;
}
