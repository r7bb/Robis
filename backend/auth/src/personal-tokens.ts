import {
  type Executor,
  personalAccessTokens,
  twoFactor,
  users,
  workspaceMembers,
  workspaces,
} from '@robis/database';
import { isUuid, type Role, TERMS_VERSION } from '@robis/shared';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { AuthenticatedUser } from './sessions.ts';
import { generateSessionToken, hashSessionToken } from './tokens.ts';

/**
 * Personal access tokens (C7): a person's key for the REST API, built from
 * the session primitives (256 bits, shown once, stored as SHA-256). A token
 * acts as its owner, with their role, in any workspace they belong to, and
 * on workspace routes only; its scopes say whether it may write. Every
 * request looks it up, so revoking it refuses the very next call.
 */

export const PERSONAL_TOKEN_PREFIX = 'rbp_';
const PERSONAL_TOKEN_LENGTH = PERSONAL_TOKEN_PREFIX.length + 43;
/** Only refresh `last_used_at` this often, so reads do not become writes. */
const LAST_USED_REFRESH_MS = 5 * 60 * 1000;

export function isPersonalToken(token: string): boolean {
  return token.length === PERSONAL_TOKEN_LENGTH && token.startsWith(PERSONAL_TOKEN_PREFIX);
}

export async function issuePersonalToken(
  db: Executor,
  input: { userId: string; name: string; scopes: readonly string[]; expiresAt: Date | null },
) {
  const secret = `${PERSONAL_TOKEN_PREFIX}${generateSessionToken()}`;
  const [row] = await db
    .insert(personalAccessTokens)
    .values({
      userId: input.userId,
      name: input.name,
      scopes: [...input.scopes],
      tokenHash: hashSessionToken(secret),
      expiresAt: input.expiresAt,
    })
    .returning();
  return { token: row!, secret };
}

/**
 * The person a token belongs to, their role in `workspaceId` and the
 * token's scopes: null when the token is unknown, revoked or expired, or
 * its owner's account is gone.
 */
export async function resolvePersonalToken(
  db: Executor,
  secret: string,
  workspaceId: string,
): Promise<{
  user: AuthenticatedUser;
  role: Role | null;
  requireTwoFactor: boolean;
  token: { id: string; scopes: string[] };
} | null> {
  if (!isPersonalToken(secret) || !isUuid(workspaceId)) return null;
  const now = new Date();
  const [row] = await db
    .select({
      tokenId: personalAccessTokens.id,
      scopes: personalAccessTokens.scopes,
      lastUsedAt: personalAccessTokens.lastUsedAt,
      id: users.id,
      email: users.email,
      name: users.name,
      username: users.username,
      avatarKind: users.avatarKind,
      avatarRef: users.avatarRef,
      termsVersion: users.termsVersion,
      hasTwoFactor: sql<boolean>`exists (select 1 from ${twoFactor} where ${twoFactor.userId} = ${users.id} and ${twoFactor.confirmedAt} is not null)`,
      role: workspaceMembers.role,
      requireTwoFactor: workspaces.requireTwoFactor,
    })
    .from(personalAccessTokens)
    .innerJoin(users, and(eq(users.id, personalAccessTokens.userId), eq(users.kind, 'human')))
    .leftJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, users.id)),
    )
    .leftJoin(workspaces, eq(workspaces.id, workspaceId))
    .where(
      and(
        eq(personalAccessTokens.tokenHash, hashSessionToken(secret)),
        isNull(personalAccessTokens.revokedAt),
        or(isNull(personalAccessTokens.expiresAt), gt(personalAccessTokens.expiresAt, now)),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;

  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > LAST_USED_REFRESH_MS) {
    await db
      .update(personalAccessTokens)
      .set({ lastUsedAt: now })
      .where(eq(personalAccessTokens.id, row.tokenId));
  }
  return {
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      username: row.username,
      kind: 'human',
      hasAvatar: row.avatarKind !== null && row.avatarRef !== null,
      hasAgreed: row.termsVersion === TERMS_VERSION,
      hasTwoFactor: Boolean(row.hasTwoFactor),
    },
    role: row.role ?? null,
    requireTwoFactor: Boolean(row.requireTwoFactor),
    token: { id: row.tokenId, scopes: row.scopes },
  };
}
