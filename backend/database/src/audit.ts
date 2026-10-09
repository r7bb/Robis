import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gt, lt, type SQL, sql } from 'drizzle-orm';
import type { Executor, Tx } from './index.ts';
import { type ACTOR_KINDS, auditEvents, auditStreamCursors, workspaces } from './schema.ts';

/**
 * The audit trail: write, read, verify.
 *
 * Every event belongs to one workspace's chain. Within a workspace, `seq`
 * runs 1, 2, 3 with no gaps, and `hash` is SHA-256 over the event's fields
 * plus the previous event's hash. Change a stored field and that row's hash
 * no longer matches; remove a row and the sequence has a hole; rewrite a row
 * and its hash and the next row's link breaks. `verifyAuditChain` names the
 * first place any of those happens.
 *
 * What it cannot catch on its own: someone who rewrites every row from the
 * edit to the end, or drops the newest rows. Both leave a chain that is
 * internally consistent. The defence is a copy held elsewhere -- the SIEM
 * stream, or a head hash someone wrote down -- which is why verification
 * reports the head.
 */

export type ActorKind = (typeof ACTOR_KINDS)[number];

export type AuditActor = {
  /** Null only for events Robis causes itself. */
  id: string | null;
  kind: ActorKind;
  requestId?: string | null;
};

export type AuditInput = {
  workspaceId: string;
  entityType: string;
  entityId: string;
  eventType: string;
  payload?: Record<string, unknown>;
};

/** Everything the hash covers, in the shape it is stored. */
export type ChainedFields = {
  workspaceId: string;
  seq: number;
  actorId: string | null;
  actorKind: ActorKind;
  requestId: string | null;
  entityType: string;
  entityId: string;
  eventType: string;
  payload: string;
  createdAt: Date;
  prevHash: string | null;
};

/** Bumped if the hashed fields ever change, so old and new rows stay checkable. */
const HASH_VERSION = 'v1';

/** ASCII unit separator: cannot occur in a uuid, a code-defined name, or JSON text. */
const SEPARATOR = '\x1f';

/**
 * Advisory-lock namespace for chain appends, so these locks cannot collide
 * with any other advisory lock taken in this database.
 */
const AUDIT_LOCK_NAMESPACE = 4242;

/**
 * How long a writer waits for the workspace's append lock before giving up.
 *
 * A waiter holds a pooled connection while it waits, so without a bound a
 * burst of writes to one busy workspace could drain the pool and stall
 * every other workspace with it. Failing one request is the better outcome.
 */
const AUDIT_LOCK_TIMEOUT = '5s';

/**
 * The chain hash. Mirrored in SQL by `robis_audit_hash` (migration 0010);
 * `tests/audit.test.ts` holds the two to the same answer.
 */
export function auditHash(fields: ChainedFields): string {
  const parts = [
    HASH_VERSION,
    fields.prevHash ?? '',
    fields.workspaceId,
    String(fields.seq),
    fields.actorId ?? '',
    fields.actorKind,
    fields.requestId ?? '',
    fields.entityType,
    fields.entityId,
    fields.eventType,
    fields.payload,
    fields.createdAt.toISOString(),
  ];

  // Unreachable through `recordAudit`, but a field containing the separator
  // would make two different events hash alike, so refuse rather than hope.
  if (parts.some((part) => part.includes(SEPARATOR))) {
    throw new Error('audit field contains the field separator');
  }

  return createHash('sha256').update(parts.join(SEPARATOR), 'utf8').digest('hex');
}

/**
 * Append one event to its workspace's chain.
 *
 * Takes a transaction, not a database, and the type enforces it: the event
 * must commit or roll back with the change it describes, and the lock below
 * is only held until the end of a transaction.
 *
 * The advisory lock serialises appends per workspace, so two concurrent
 * writers cannot both read seq 41 and both write 42. It is held until commit,
 * which is also what keeps `seq` in commit order: event 43 cannot be numbered
 * until 42 is visible. Call this last in the transaction, so the lock is held
 * for as little of it as possible. Relies on READ COMMITTED (the default):
 * the select after the lock must see the previous holder's committed row.
 */
export async function recordAudit(tx: Tx, actor: AuditActor, input: AuditInput) {
  // Uuids are hashed in the form Postgres returns them, so a client that sent
  // one in upper case cannot produce a row that later fails verification.
  const workspaceId = input.workspaceId.toLowerCase();

  // `set local` ends with the transaction, and the audit write is the last
  // statement in it, so nothing else inherits the shorter timeout.
  await tx.execute(sql.raw(`set local lock_timeout = '${AUDIT_LOCK_TIMEOUT}'`));
  // `hashtext` folds the workspace id to 32 bits. Two workspaces that collide
  // share a lock and queue behind each other; correctness is unaffected,
  // because the read below is filtered by workspace.
  await tx.execute(
    sql`select pg_advisory_xact_lock(${AUDIT_LOCK_NAMESPACE}, hashtext(${workspaceId}))`,
  );

  const [last] = await tx
    .select({ seq: auditEvents.seq, hash: auditEvents.hash })
    .from(auditEvents)
    .where(eq(auditEvents.workspaceId, workspaceId))
    .orderBy(desc(auditEvents.seq))
    .limit(1);

  const fields: ChainedFields = {
    workspaceId,
    seq: (last?.seq ?? 0) + 1,
    actorId: actor.id?.toLowerCase() ?? null,
    actorKind: actor.kind,
    requestId: actor.requestId ?? null,
    entityType: input.entityType,
    entityId: input.entityId.toLowerCase(),
    eventType: input.eventType,
    payload: JSON.stringify(input.payload ?? {}),
    // Set here rather than by the column default, and at millisecond
    // precision, so the value hashed is exactly the value stored.
    createdAt: new Date(),
    prevHash: last?.hash ?? null,
  };

  const [row] = await tx
    .insert(auditEvents)
    .values({ ...fields, hash: auditHash(fields) })
    .returning();

  return row!;
}

export type AuditRow = typeof auditEvents.$inferSelect;

export type ChainBreak = {
  seq: number;
  /** Null when the row is missing altogether. */
  eventId: string | null;
  reason: 'missing' | 'altered' | 'relinked' | 'truncated';
  detail: string;
};

export type ChainReport = {
  ok: boolean;
  checked: number;
  /** The newest event seen, for comparison with a copy held elsewhere. */
  head: { seq: number; hash: string } | null;
  broken: ChainBreak | null;
};

/** Rows per round trip while walking the chain, to bound memory. */
const VERIFY_BATCH = 500;

/**
 * Whether a row's stored hash is the hash of its contents.
 *
 * A row edited to contain the field separator cannot be hashed at all; that
 * is a changed row too, and must be reported as one rather than surfacing as
 * a 500 that reads as "could not check".
 */
function hashMatches(row: AuditRow): boolean {
  try {
    return auditHash(row) === row.hash;
  } catch {
    return false;
  }
}

/** Check one row against the one before it. Null means it holds. */
function checkLink(row: AuditRow, expectedSeq: number, prevHash: string | null): ChainBreak | null {
  if (row.seq !== expectedSeq) {
    return {
      seq: expectedSeq,
      eventId: null,
      reason: 'missing',
      detail: `Event ${expectedSeq} is missing: the chain jumps from ${expectedSeq - 1} to ${row.seq}.`,
    };
  }

  if (!hashMatches(row)) {
    return {
      seq: row.seq,
      eventId: row.id,
      reason: 'altered',
      detail: `Event ${row.seq} was changed after it was written: its contents no longer match its hash.`,
    };
  }

  if (row.prevHash !== prevHash) {
    return {
      seq: row.seq,
      eventId: row.id,
      reason: 'relinked',
      detail: `Event ${row.seq} does not follow event ${row.seq - 1}: one of them was replaced.`,
    };
  }

  return null;
}

/**
 * The stream's delivered position, if the workspace has been streamed.
 *
 * The one outside copy the database itself knows about: if the chain now
 * ends before a seq the receiver already acknowledged, the newest events
 * were removed, which a chain on its own cannot notice.
 */
async function deliveredSeq(db: Executor, workspaceId: string): Promise<number> {
  const [cursor] = await db
    .select({ seq: auditStreamCursors.deliveredSeq })
    .from(auditStreamCursors)
    .where(eq(auditStreamCursors.workspaceId, workspaceId));

  return cursor?.seq ?? 0;
}

function truncated(head: ChainReport['head'], delivered: number): ChainBreak {
  const last = head?.seq ?? 0;
  return {
    seq: last + 1,
    eventId: null,
    reason: 'truncated',
    detail: `The trail ends at event ${last}, but the SIEM stream already received up to ${delivered}: newer events were removed.`,
  };
}

/** Walk a workspace's chain from the first event and report the first break. */
export async function verifyAuditChain(db: Executor, workspaceId: string): Promise<ChainReport> {
  let expectedSeq = 1;
  let prevHash: string | null = null;
  let head: ChainReport['head'] = null;
  let checked = 0;

  for (;;) {
    const rows = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.workspaceId, workspaceId), gt(auditEvents.seq, expectedSeq - 1)))
      .orderBy(asc(auditEvents.seq))
      .limit(VERIFY_BATCH);

    for (const row of rows) {
      const broken = checkLink(row, expectedSeq, prevHash);
      if (broken) return { ok: false, checked, head, broken };

      checked++;
      expectedSeq = row.seq + 1;
      prevHash = row.hash;
      head = { seq: row.seq, hash: row.hash };
    }

    if (rows.length < VERIFY_BATCH) break;
  }

  const delivered = await deliveredSeq(db, workspaceId);
  if (delivered > (head?.seq ?? 0)) {
    return { ok: false, checked, head, broken: truncated(head, delivered) };
  }

  return { ok: true, checked, head, broken: null };
}

export type AuditQuery = {
  /** Events with a greater seq, oldest first. Use 0 to read from the start. */
  after?: number;
  /** Events with a smaller seq, newest first. The default with neither. */
  before?: number;
  limit: number;
  actorId?: string;
  entityType?: string;
};

/**
 * A page of one workspace's trail, keyset-paged by `seq`.
 *
 * `after` reads forwards, which is what an exporter wants: remember the last
 * seq and ask for what came next. Without it the page is newest first, which
 * is what a person reading the trail wants.
 */
export async function listAuditEvents(db: Executor, workspaceId: string, query: AuditQuery) {
  const forwards = query.after !== undefined;
  const filters: SQL[] = [eq(auditEvents.workspaceId, workspaceId)];

  if (query.after !== undefined) filters.push(gt(auditEvents.seq, query.after));
  if (query.before !== undefined) filters.push(lt(auditEvents.seq, query.before));
  if (query.actorId) filters.push(eq(auditEvents.actorId, query.actorId));
  if (query.entityType) filters.push(eq(auditEvents.entityType, query.entityType));

  const rows = await db
    .select()
    .from(auditEvents)
    .where(and(...filters))
    .orderBy(forwards ? asc(auditEvents.seq) : desc(auditEvents.seq))
    .limit(query.limit);

  const last = rows.at(-1);
  return { rows, nextCursor: rows.length === query.limit && last ? last.seq : null };
}

/**
 * The stored payload as JSON, or the raw text if it no longer parses.
 *
 * Only a row edited behind the application's back can fail to parse. It must
 * still export -- an exporter that stops at the tampered row hides exactly
 * the row someone needs to see -- and the chain check reports it.
 */
function parsePayload(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * The wire shape for export and streaming. Stable: receivers depend on it.
 *
 * `payload` is parsed for convenience. A receiver that wants to recompute a
 * hash itself re-serialises it with `JSON.stringify`, which reproduces the
 * stored text for everything Robis writes.
 */
export function toExported(row: AuditRow) {
  return {
    /** Idempotency key: the same event always carries the same key. */
    key: row.id,
    workspaceId: row.workspaceId,
    seq: row.seq,
    occurredAt: row.createdAt.toISOString(),
    actor: { id: row.actorId, kind: row.actorKind },
    requestId: row.requestId,
    entity: { type: row.entityType, id: row.entityId },
    type: row.eventType,
    payload: parsePayload(row.payload),
    prevHash: row.prevHash,
    hash: row.hash,
  };
}

export type ExportedAuditEvent = ReturnType<typeof toExported>;

/**
 * Workspaces with events the stream has not delivered yet, in a fixed order.
 *
 * The newest seq per workspace is a single backward probe of the
 * `(workspace_id, seq)` key, so a fully delivered workspace costs one index
 * lookup per poll rather than a walk over everything it ever recorded.
 */
export async function workspacesBehindStream(db: Executor) {
  const rows = await db.execute<{ id: string; delivered_seq: string | number }>(sql`
    select w.id, coalesce(c.delivered_seq, 0) as delivered_seq
    from ${workspaces} w
    left join ${auditStreamCursors} c on c.workspace_id = w.id
    where (
      select a.seq from ${auditEvents} a
      where a.workspace_id = w.id
      order by a.seq desc
      limit 1
    ) > coalesce(c.delivered_seq, 0)
    order by w.id
  `);

  return rows.map((row) => ({ workspaceId: row.id, deliveredSeq: Number(row.delivered_seq) }));
}

/**
 * Record that a receiver acknowledged everything up to `seq`.
 *
 * `greatest` keeps the cursor from moving backwards when two workers ship
 * the same workspace at once: the slower one may finish second with an
 * older position, and must not undo the faster one's progress.
 */
export async function advanceStreamCursor(db: Executor, workspaceId: string, seq: number) {
  await db
    .insert(auditStreamCursors)
    .values({ workspaceId, deliveredSeq: seq })
    .onConflictDoUpdate({
      target: auditStreamCursors.workspaceId,
      set: {
        deliveredSeq: sql`greatest(${auditStreamCursors.deliveredSeq}, excluded.delivered_seq)`,
        updatedAt: new Date(),
      },
    });
}
