import { type Executor, sessions, users } from '@robis/database';
import { TERMS_VERSION } from '@robis/shared';
import { and, desc, eq, gt, lt, ne } from 'drizzle-orm';
import {
  generateSessionToken,
  hashSessionToken,
  SESSION_IDLE_MS,
  sessionExpiry,
} from './tokens.ts';

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  /** The app-specific `@handle`. */
  username: string;
  /**
   * Whether a picture has been chosen. Workspaces are closed to an account
   * without one; see `requireMembership`.
   */
  hasAvatar: boolean;
  /**
   * Whether the stored agreement is to the current `TERMS_VERSION`.
   * Workspaces are closed until it is; see `assertHasAgreed`.
   */
  hasAgreed: boolean;
};

/** Only refresh `last_used_at` once an hour, to keep reads from becoming writes. */
const LAST_USED_REFRESH_MS = 60 * 60 * 1000;

export async function createSession(
  db: Executor,
  userId: string,
  userAgent: string | undefined,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = sessionExpiry();

  await db.insert(sessions).values({
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt,
    userAgent: userAgent?.slice(0, 500) ?? null,
  });

  return { token, expiresAt };
}

export async function resolveSession(
  db: Executor,
  token: string,
): Promise<AuthenticatedUser | null> {
  const tokenHash = hashSessionToken(token);

  const [row] = await db
    .select({
      sessionId: sessions.id,
      lastUsedAt: sessions.lastUsedAt,
      id: users.id,
      email: users.email,
      name: users.name,
      username: users.username,
      avatarKind: users.avatarKind,
      avatarRef: users.avatarRef,
      termsVersion: users.termsVersion,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    // Expiry is enforced in the query rather than in JS so an expired session
    // can never be treated as valid by a caller that forgets to check. Both
    // limits: 30 days from sign-in, and 7 days since it was last used.
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        gt(sessions.expiresAt, new Date()),
        gt(sessions.lastUsedAt, new Date(Date.now() - SESSION_IDLE_MS)),
      ),
    )
    .limit(1);

  if (!row) return null;

  if (Date.now() - row.lastUsedAt.getTime() > LAST_USED_REFRESH_MS) {
    await db.update(sessions).set({ lastUsedAt: new Date() }).where(eq(sessions.id, row.sessionId));
  }

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    username: row.username,
    // Both halves, so a row left half-written can never count as a picture.
    hasAvatar: row.avatarKind !== null && row.avatarRef !== null,
    hasAgreed: row.termsVersion === TERMS_VERSION,
  };
}

export async function revokeSession(db: Executor, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
}

/**
 * Invalidate every session for a user, including the one making the request.
 *
 * Used on password change, which then issues a fresh session for the caller.
 * Rotating the caller's own token rather than sparing it matters: if the
 * password is being changed *because* a token leaked, sparing the current one
 * would leave the attacker signed in.
 */
export async function revokeAllSessions(db: Executor, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/**
 * Sign out everywhere except here.
 *
 * The current session is identified by its token hash rather than by an id
 * passed in from the caller, so there is no way to ask this to spare someone
 * else's session.
 */
export async function revokeOtherSessions(
  db: Executor,
  userId: string,
  currentToken: string,
): Promise<number> {
  const removed = await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.tokenHash, hashSessionToken(currentToken))))
    .returning({ id: sessions.id });

  return removed.length;
}

export type SessionSummary = {
  id: string;
  createdAt: Date;
  lastUsedAt: Date;
  userAgent: string | null;
  /** True for the session making the request. */
  current: boolean;
};

/**
 * Active sessions for a user.
 *
 * Token hashes never leave this function -- the hash of the caller's token is
 * compared here to mark the current row, and only the flag is returned. A
 * listing that included hashes would turn "see your devices" into "collect
 * every credential you own".
 */
export async function listSessions(
  db: Executor,
  userId: string,
  currentToken: string,
): Promise<SessionSummary[]> {
  const currentHash = hashSessionToken(currentToken);

  const rows = await db
    .select({
      id: sessions.id,
      tokenHash: sessions.tokenHash,
      createdAt: sessions.createdAt,
      lastUsedAt: sessions.lastUsedAt,
      userAgent: sessions.userAgent,
    })
    .from(sessions)
    // Expired rows are swept by a background job, so they can still be present
    // here; showing them as active devices would be wrong.
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastUsedAt));

  return rows.map(({ tokenHash, ...row }) => ({ ...row, current: tokenHash === currentHash }));
}

export async function deleteExpiredSessions(db: Executor): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
