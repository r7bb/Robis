import { MAX_USERNAME_HOLDS, USERNAME_HOLD_DAYS, usernameKey } from '@robis/shared';
import { and, eq, gt, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { Executor, Tx } from './index.ts';
import { usernameHistory, users } from './schema.ts';

/**
 * Claiming, releasing and holding usernames.
 *
 * Uniqueness is by key (`usernameKey`): the unique index on
 * `users.username_key` refuses a lookalike outright. A released name is
 * held for `USERNAME_HOLD_DAYS` in `username_history`, and only its last
 * owner may take it back in that time.
 *
 * The index alone cannot see a hold, so a sign-up locks the key it wants
 * and a rename locks both of its keys before checking (see `lockUsername`).
 *
 * There is no account deletion yet. When there is, it must hold the
 * deleted account's name and clear `username` on its history rows in the
 * same transaction: the foreign key only clears `user_id`.
 */

/** Advisory-lock namespace for username keys; audit chains use 4242 and 4243. */
const USERNAME_LOCK_NAMESPACE = 4244;
const DAY_MS = 24 * 60 * 60 * 1000;

export type UsernameClaim = 'free' | 'taken' | 'held';

/**
 * Serialise every claim on these names' keys until the transaction ends.
 *
 * A rename passes both its old and new names: locking only the new one
 * would let a sign-up for the old one check while the rename is still
 * uncommitted, then win the name the moment it commits, before the hold
 * is visible. Keys are locked in sorted order, so two renames swapping
 * names cannot deadlock.
 */
export async function lockUsername(tx: Tx, ...names: string[]) {
  const keys = [...new Set(names.map(usernameKey))].sort();
  for (const key of keys) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${USERNAME_LOCK_NAMESPACE}, hashtext(${key}))`,
    );
  }
}

/**
 * Whether `userId` may let go of another name now. Taking back a name you
 * hold ends that hold, so it does not count against you.
 */
export async function canHoldAnother(tx: Tx, userId: string, next: string): Promise<boolean> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(usernameHistory)
    .where(
      and(
        eq(usernameHistory.userId, userId),
        gt(usernameHistory.heldUntil, sql`now()`),
        ne(usernameHistory.usernameKey, usernameKey(next)),
      ),
    );
  return (row?.n ?? 0) < MAX_USERNAME_HOLDS;
}

/**
 * Whether `username` can be had by `userId` (null for someone signing up):
 * free, taken by another account as it is or as a lookalike, or held after
 * another account let it go.
 */
export async function usernameClaim(
  db: Executor,
  username: string,
  userId: string | null,
): Promise<UsernameClaim> {
  const key = usernameKey(username);

  const [holder] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      userId ? and(eq(users.usernameKey, key), ne(users.id, userId)) : eq(users.usernameKey, key),
    )
    .limit(1);
  if (holder) return 'taken';

  const [hold] = await db
    .select({ id: usernameHistory.id })
    .from(usernameHistory)
    .where(
      and(
        eq(usernameHistory.usernameKey, key),
        gt(usernameHistory.heldUntil, sql`now()`),
        // Holds bind everyone but their owner. An erased owner is nobody, so
        // their hold binds everyone (and someone signing up has no id yet).
        userId ? or(isNull(usernameHistory.userId), ne(usernameHistory.userId, userId)) : undefined,
      ),
    )
    .limit(1);
  return hold ? 'held' : 'free';
}

/**
 * Record `previous` as let go by `userId`, held from now. Called in the
 * same transaction as the rename, so a name is never free in between.
 */
export async function releaseUsername(tx: Tx, userId: string, previous: string, next: string) {
  // Taking back a name of your own ends its hold: it is yours again.
  await tx
    .delete(usernameHistory)
    .where(
      and(eq(usernameHistory.userId, userId), eq(usernameHistory.usernameKey, usernameKey(next))),
    );

  // Respelling a name (`ada.l` to `ada_l`) releases nothing.
  if (usernameKey(previous) === usernameKey(next)) return;

  await tx.insert(usernameHistory).values({
    userId,
    username: previous,
    usernameKey: usernameKey(previous),
    heldUntil: new Date(Date.now() + USERNAME_HOLD_DAYS * DAY_MS),
  });
}

/** Housekeeping: holds that have run out say nothing any more. */
export async function deleteExpiredUsernameHolds(db: Executor) {
  await db.delete(usernameHistory).where(lte(usernameHistory.heldUntil, sql`now()`));
}

/**
 * Forget which names a person used to have. The keys and holds stay, so an
 * erasure does not hand an old name to whoever asks for it next. Returns
 * how many rows were cleared. DRAFT FOR LEGAL REVIEW, as `audit:erase` is.
 */
export async function eraseUsernameHistory(db: Executor, userId: string): Promise<number> {
  const rows = await db
    .update(usernameHistory)
    .set({ username: null, userId: null })
    .where(and(eq(usernameHistory.userId, userId.toLowerCase()), isNotNull(usernameHistory.userId)))
    .returning({ id: usernameHistory.id });
  return rows.length;
}
