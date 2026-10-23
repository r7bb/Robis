import { and, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type { Executor } from './index.ts';
import { signups } from './schema.ts';

/** How long an unfinished sign-up is kept after its link has run out. */
export const SIGNUP_KEEP_DAYS = 7;

/**
 * Use up a sign-up link: delete every unfinished sign-up for the address
 * the link was sent to, and return that address, or null if the link is
 * unknown or has run out.
 *
 * One statement, so two finishes racing with one link cannot both succeed:
 * the second waits on the rows the first deleted, then finds none. Run it
 * in the transaction that makes the account, so a refused username rolls
 * it back and the link stays good for another try.
 */
export async function claimSignup(tx: Executor, tokenHash: string): Promise<string | null> {
  const linked = tx
    .select({ email: signups.email })
    .from(signups)
    .where(and(eq(signups.tokenHash, tokenHash), gt(signups.expiresAt, sql`now()`)));
  const claimed = await tx
    .delete(signups)
    .where(inArray(signups.email, linked))
    .returning({ email: signups.email });
  return claimed[0]?.email ?? null;
}

/**
 * Housekeeping: a sign-up nobody finished stops naming its address a week
 * after its link ran out (or, if no link was ever sent, a week after it
 * was started).
 */
export async function deleteStaleSignups(db: Executor) {
  await db
    .delete(signups)
    .where(
      lt(
        sql`coalesce(${signups.expiresAt}, ${signups.createdAt})`,
        sql`now() - make_interval(days => ${SIGNUP_KEEP_DAYS})`,
      ),
    );
}
