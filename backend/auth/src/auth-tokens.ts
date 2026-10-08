import { type AuthTokenPurpose, authTokens, type Executor } from '@relay/database';
import { EMAIL_VERIFICATION_TTL_MINUTES, PASSWORD_RESET_TTL_MINUTES } from '@relay/shared';
import { and, eq, gt, lt } from 'drizzle-orm';
import { generateSessionToken, hashSessionToken } from './tokens.ts';

/**
 * One-time tokens for password reset and email verification.
 *
 * The primitives are the session ones: 256 bits of randomness, stored as its
 * SHA-256. Reusing them rather than inventing a second scheme means there is
 * one answer in this codebase to "how is a bearer secret held", and improving
 * that answer improves both.
 *
 * What differs from a session is lifetime and reach. A session is long-lived
 * and only proves who you are; a reset token is short-lived and can *change*
 * who controls the account, so it expires quickly, works once, and is scoped
 * to the single thing it was issued for.
 */

/** Short: a live reset link is a standing takeover risk. */
export const PASSWORD_RESET_TTL_MS = PASSWORD_RESET_TTL_MINUTES * 60_000;

/** Longer: a welcome message can reasonably sit unread for a day. */
export const EMAIL_VERIFICATION_TTL_MS = EMAIL_VERIFICATION_TTL_MINUTES * 60_000;

const TTL_BY_PURPOSE: Record<AuthTokenPurpose, number> = {
  password_reset: PASSWORD_RESET_TTL_MS,
  email_verification: EMAIL_VERIFICATION_TTL_MS,
};

export function ttlFor(purpose: AuthTokenPurpose): number {
  return TTL_BY_PURPOSE[purpose];
}

/** Minutes, for the message bodies that tell the reader how long they have. */
export function ttlMinutesFor(purpose: AuthTokenPurpose): number {
  return Math.round(ttlFor(purpose) / 60_000);
}

export type IssuedToken = { token: string; expiresAt: Date };

/**
 * Issue a token, replacing any earlier one for the same user and purpose.
 *
 * The replacement matters: without it, asking for a second reset link leaves
 * the first live for the rest of its own lifetime, so an older message that
 * leaks is still spendable.
 *
 * An upsert on `(user_id, purpose)` rather than delete-then-insert. The
 * delete-then-insert version was not safe under concurrency: two requests
 * arriving together each delete nothing the other had yet written, then both
 * insert, and the account ends up with two live links. The unique index makes
 * that impossible and the conflict clause picks one winner without a
 * transaction.
 *
 * `issuedAt` exists for tests that need an already-expired token; production
 * callers leave it alone.
 */
export async function issueAuthToken(
  db: Executor,
  userId: string,
  purpose: AuthTokenPurpose,
  issuedAt: Date = new Date(),
): Promise<IssuedToken> {
  const token = generateSessionToken();
  const expiresAt = new Date(issuedAt.getTime() + ttlFor(purpose));

  await db
    .insert(authTokens)
    .values({ userId, purpose, tokenHash: hashSessionToken(token), expiresAt })
    .onConflictDoUpdate({
      target: [authTokens.userId, authTokens.purpose],
      set: { tokenHash: hashSessionToken(token), expiresAt, createdAt: issuedAt },
    });

  return { token, expiresAt };
}

/** Drop a user's tokens for one purpose, without issuing a replacement. */
export async function revokeAuthTokens(
  db: Executor,
  userId: string,
  purpose: AuthTokenPurpose,
): Promise<void> {
  await db
    .delete(authTokens)
    .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose)));
}

/**
 * Spend a token, returning the user it belonged to, or null.
 *
 * Null covers every failure -- unknown, expired, already used, wrong purpose --
 * because the caller must not tell those apart to whoever is holding the link
 * either. A form that says "this link expired" rather than "no such link"
 * confirms the token once existed.
 *
 * The delete *is* the check: `DELETE ... RETURNING` with expiry and purpose in
 * the predicate either removes exactly one row or none, so two requests
 * arriving together cannot both succeed. Reading the row and then deleting it
 * would leave that race open.
 */
export async function consumeAuthToken(
  db: Executor,
  token: string,
  purpose: AuthTokenPurpose,
  now: Date = new Date(),
): Promise<string | null> {
  if (!token) return null;

  const [spent] = await db
    .delete(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, hashSessionToken(token)),
        eq(authTokens.purpose, purpose),
        gt(authTokens.expiresAt, now),
      ),
    )
    .returning({ userId: authTokens.userId });

  return spent?.userId ?? null;
}

/** Housekeeping, run by the same job that sweeps expired sessions. */
export async function deleteExpiredAuthTokens(db: Executor): Promise<number> {
  const removed = await db
    .delete(authTokens)
    .where(lt(authTokens.expiresAt, new Date()))
    .returning({ id: authTokens.id });

  return removed.length;
}
