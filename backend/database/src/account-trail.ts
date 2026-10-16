import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, asc, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { AUDIT_KEY_ID, auditKeyring } from './audit-keys.ts';
import type { Database, Executor, Tx } from './index.ts';
import { accountEvents } from './schema.ts';

/**
 * Each account's own trail.
 *
 * Signing in, failing to, signing out, changing or resetting the password,
 * revoking sessions: the things a person wants to look back over when they
 * suspect someone else has been in their account. They belong to the person,
 * not to any workspace, so each account has its own chain, numbered from 1
 * and signed with the same keys as the workspace trail. The hashed text
 * starts with its own tag, so an account event can never pass as a
 * workspace event or the reverse.
 *
 * Deliberately little is kept: no address, no location, no device beyond
 * what the sessions list already shows. The trail says what happened and
 * when; the sessions page says where you are signed in now.
 */

export const ACCOUNT_EVENT_TYPES = [
  'auth.signed_in',
  'auth.sign_in_failed',
  'auth.signed_out',
  'auth.password_changed',
  'auth.password_reset',
  'auth.sessions_revoked',
  'auth.username_changed',
] as const;

export type AccountEventType = (typeof ACCOUNT_EVENT_TYPES)[number];

const HASH_TAG = 'acct-v1';
const SEPARATOR = '\x1f';
/** Advisory-lock namespace for account chains; workspace chains use 4242. */
const ACCOUNT_LOCK_NAMESPACE = 4243;
const LOCK_TIMEOUT = '5s';

type HashedFields = {
  userId: string;
  seq: number;
  eventType: string;
  payload: string;
  requestId: string | null;
  createdAt: Date;
  prevHash: string | null;
  keyId: string;
};

function accountHash(fields: HashedFields): string {
  const secret = auditKeyring().keys.get(fields.keyId);
  if (!secret) throw new Error(`audit key "${fields.keyId}" is not configured`);
  const parts = [
    HASH_TAG,
    fields.keyId,
    fields.prevHash ?? '',
    fields.userId,
    String(fields.seq),
    fields.eventType,
    fields.payload,
    fields.requestId ?? '',
    fields.createdAt.toISOString(),
  ];
  if (parts.some((part) => part.includes(SEPARATOR))) {
    throw new Error('account event field contains the field separator');
  }
  return createHmac('sha256', secret).update(parts.join(SEPARATOR), 'utf8').digest('hex');
}

export type AccountEventOptions = {
  payload?: Record<string, unknown>;
  requestId?: string | null;
  /**
   * Skip the write if an event of the same type was recorded this recently.
   * For failed sign-ins: anyone can cause one, and each would otherwise be a
   * permanent row in someone else's history.
   */
  coalesceWithinMs?: number;
};

/** Append one event to an account's chain, inside the caller's transaction. */
export async function recordAccountEvent(
  tx: Tx,
  userId: string,
  eventType: AccountEventType,
  options: AccountEventOptions = {},
) {
  const id = userId.toLowerCase();
  await tx.execute(sql.raw(`set local lock_timeout = '${LOCK_TIMEOUT}'`));
  await tx.execute(sql`select pg_advisory_xact_lock(${ACCOUNT_LOCK_NAMESPACE}, hashtext(${id}))`);

  if (options.coalesceWithinMs) {
    const [recent] = await tx
      .select({ id: accountEvents.id })
      .from(accountEvents)
      .where(
        and(
          eq(accountEvents.userId, id),
          eq(accountEvents.eventType, eventType),
          gt(accountEvents.createdAt, new Date(Date.now() - options.coalesceWithinMs)),
        ),
      )
      .limit(1);
    if (recent) return;
  }

  const [last] = await tx
    .select({ seq: accountEvents.seq, hash: accountEvents.hash })
    .from(accountEvents)
    .where(eq(accountEvents.userId, id))
    .orderBy(desc(accountEvents.seq))
    .limit(1);

  const fields: HashedFields = {
    userId: id,
    seq: (last?.seq ?? 0) + 1,
    eventType,
    payload: JSON.stringify(options.payload ?? {}),
    requestId: options.requestId ?? null,
    createdAt: new Date(),
    prevHash: last?.hash ?? null,
    keyId: auditKeyring().currentId,
  };
  await tx.insert(accountEvents).values({ ...fields, hash: accountHash(fields) });
}

/** The same, in a transaction of its own, for callers outside one. */
export function recordAccountEventNow(
  db: Database,
  userId: string,
  eventType: AccountEventType,
  options: AccountEventOptions = {},
) {
  return db.transaction((tx) => recordAccountEvent(tx, userId, eventType, options));
}

/** Writes scheduled for after a reply, so a caller can wait for them. */
const deferred = new Set<Promise<void>>();

/**
 * Record an event after the current reply has been sent.
 *
 * For an event whose timing must not show in the response (a failed
 * sign-in, which only an existing account can have). Errors go to
 * `onError`; nothing is thrown at the request that caused it.
 */
export function deferAccountEvent(
  db: Database,
  userId: string,
  eventType: AccountEventType,
  options: AccountEventOptions,
  onError: (error: unknown) => void,
) {
  const write = new Promise<void>((resolve) => {
    setImmediate(() => {
      recordAccountEventNow(db, userId, eventType, options).catch(onError).finally(resolve);
    });
  });
  deferred.add(write);
  write.finally(() => deferred.delete(write));
}

/** Wait for every deferred write still in flight: before tests reset, and at shutdown. */
export async function settleDeferredAccountEvents() {
  await Promise.all([...deferred]);
}

export type AccountEventRow = typeof accountEvents.$inferSelect;

/** One account's events, newest first, keyset-paged by seq. */
export async function listAccountEvents(
  db: Executor,
  userId: string,
  query: { before?: number; limit: number },
) {
  const rows = await db
    .select()
    .from(accountEvents)
    .where(
      and(
        eq(accountEvents.userId, userId),
        query.before !== undefined ? lt(accountEvents.seq, query.before) : undefined,
      ),
    )
    .orderBy(desc(accountEvents.seq))
    .limit(query.limit);
  const last = rows.at(-1);
  return { rows, nextCursor: rows.length === query.limit && last ? last.seq : null };
}

export type AccountChainReport = {
  ok: boolean;
  checked: number;
  broken: { seq: number; reason: 'missing' | 'altered' | 'relinked' | 'unverifiable' } | null;
};

function rowHolds(row: AccountEventRow): 'ok' | 'altered' | 'unknown-key' {
  if (!AUDIT_KEY_ID.test(row.keyId)) return 'altered';
  if (!auditKeyring().keys.has(row.keyId)) return 'unknown-key';
  try {
    const expected = Buffer.from(accountHash(row), 'utf8');
    const stored = Buffer.from(row.hash, 'utf8');
    return expected.length === stored.length && timingSafeEqual(expected, stored)
      ? 'ok'
      : 'altered';
  } catch {
    return 'altered';
  }
}

const VERIFY_BATCH = 500;

type Walk = { expectedSeq: number; prevHash: string | null; checked: number };

/** Check one row against the walk so far; a break, or null if it holds. */
function checkRow(row: AccountEventRow, walk: Walk): AccountChainReport['broken'] {
  if (row.seq !== walk.expectedSeq) return { seq: walk.expectedSeq, reason: 'missing' };
  const holds = rowHolds(row);
  if (holds !== 'ok') {
    return { seq: row.seq, reason: holds === 'unknown-key' ? 'unverifiable' : 'altered' };
  }
  if (row.prevHash !== walk.prevHash) return { seq: row.seq, reason: 'relinked' };
  return null;
}

/** Walk an account's chain from the first event and report the first break. */
export async function verifyAccountChain(
  db: Executor,
  userId: string,
): Promise<AccountChainReport> {
  const walk: Walk = { expectedSeq: 1, prevHash: null, checked: 0 };

  for (;;) {
    const rows = await db
      .select()
      .from(accountEvents)
      .where(and(eq(accountEvents.userId, userId), gt(accountEvents.seq, walk.expectedSeq - 1)))
      .orderBy(asc(accountEvents.seq))
      .limit(VERIFY_BATCH);

    for (const row of rows) {
      const broken = checkRow(row, walk);
      if (broken) return { ok: false, checked: walk.checked, broken };
      walk.checked++;
      walk.expectedSeq = row.seq + 1;
      walk.prevHash = row.hash;
    }
    if (rows.length < VERIFY_BATCH) break;
  }
  return { ok: true, checked: walk.checked, broken: null };
}
