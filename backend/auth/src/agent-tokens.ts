import { agentTokens, type Executor, users, workspaceMembers } from '@robis/database';
import { isUuid, type Role } from '@robis/shared';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { AuthenticatedUser } from './sessions.ts';
import { generateSessionToken, hashSessionToken } from './tokens.ts';

/**
 * The keys agents act with (B5).
 *
 * The primitives are the session ones: 256 bits of randomness, shown once
 * and stored as its SHA-256. The prefix only makes a leaked one easy to
 * recognise in a log or a scanner; it adds nothing to the secret.
 *
 * Every request looks its token up, so revoking one refuses the very next
 * call that carries it. A token reaches one workspace only: on any other
 * workspace it resolves to no membership, which the API answers with the
 * same 404 a stranger gets.
 */

export const AGENT_TOKEN_PREFIX = 'rba_';

/** Only refresh `last_used_at` this often, so reads do not become writes. */
const LAST_USED_REFRESH_MS = 60 * 60 * 1000;

/** The prefix and 32 random bytes in base64url: anything else is not one of ours. */
const AGENT_TOKEN_LENGTH = AGENT_TOKEN_PREFIX.length + 43;

export function isAgentToken(token: string): boolean {
  return token.length === AGENT_TOKEN_LENGTH && token.startsWith(AGENT_TOKEN_PREFIX);
}

export type IssuedAgentToken = { id: string; secret: string };

export async function issueAgentToken(
  db: Executor,
  input: {
    agentId: string;
    workspaceId: string;
    createdBy: string;
    label: string;
    expiresAt?: Date | null;
  },
): Promise<IssuedAgentToken> {
  const secret = `${AGENT_TOKEN_PREFIX}${generateSessionToken()}`;
  const [row] = await db
    .insert(agentTokens)
    .values({
      agentId: input.agentId,
      workspaceId: input.workspaceId,
      createdBy: input.createdBy,
      label: input.label,
      tokenHash: hashSessionToken(secret),
      expiresAt: input.expiresAt ?? null,
    })
    .returning({ id: agentTokens.id });
  return { id: row!.id, secret };
}

/**
 * The agent a token belongs to, and its role in `workspaceId`: null when
 * the token is unknown, revoked or expired, and a null role when the path
 * names another workspace than the token's.
 */
export async function resolveAgentToken(
  db: Executor,
  secret: string,
  workspaceId: string,
): Promise<{
  user: AuthenticatedUser;
  role: Role | null;
  /** Which token, and whether it was minted for one run (it expires). */
  token: { id: string; perRun: boolean };
} | null> {
  if (!isAgentToken(secret)) return null;

  const now = new Date();
  const [row] = await db
    .select({
      tokenId: agentTokens.id,
      tokenExpiresAt: agentTokens.expiresAt,
      tokenWorkspaceId: agentTokens.workspaceId,
      lastUsedAt: agentTokens.lastUsedAt,
      id: users.id,
      email: users.email,
      name: users.name,
      username: users.username,
      role: workspaceMembers.role,
    })
    .from(agentTokens)
    .innerJoin(users, and(eq(users.id, agentTokens.agentId), eq(users.kind, 'agent')))
    .leftJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, agentTokens.workspaceId),
        eq(workspaceMembers.userId, agentTokens.agentId),
      ),
    )
    .where(
      and(
        eq(agentTokens.tokenHash, hashSessionToken(secret)),
        isNull(agentTokens.revokedAt),
        or(isNull(agentTokens.expiresAt), gt(agentTokens.expiresAt, now)),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);

  if (!row) return null;

  const sameWorkspace = isUuid(workspaceId) && row.tokenWorkspaceId === workspaceId.toLowerCase();
  // Only use in its own workspace counts as use: a token tried elsewhere
  // does nothing, and should not look used.
  const stale = !row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > LAST_USED_REFRESH_MS;
  if (sameWorkspace && stale) {
    await db.update(agentTokens).set({ lastUsedAt: now }).where(eq(agentTokens.id, row.tokenId));
  }

  return {
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      username: row.username,
      kind: 'agent',
      // An agent is given a generated picture when it is made, and agrees to
      // nothing: the admin who added it answers for it.
      hasAvatar: true,
      hasAgreed: true,
    },
    role: sameWorkspace ? (row.role ?? null) : null,
    token: { id: row.tokenId, perRun: row.tokenExpiresAt !== null },
  };
}

/** Revoke one of an agent's tokens; true if there was a live one to revoke. */
export async function revokeAgentToken(
  db: Executor,
  input: { tokenId: string; agentId: string; workspaceId: string },
): Promise<boolean> {
  const revoked = await db
    .update(agentTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(agentTokens.id, input.tokenId),
        eq(agentTokens.agentId, input.agentId),
        eq(agentTokens.workspaceId, input.workspaceId),
        isNull(agentTokens.revokedAt),
      ),
    )
    .returning({ id: agentTokens.id });
  return revoked.length > 0;
}

/** Revoke every token an agent holds in a workspace, when it is removed. */
export async function revokeAllAgentTokens(
  db: Executor,
  input: { agentId: string; workspaceId: string },
): Promise<void> {
  await db
    .update(agentTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(agentTokens.agentId, input.agentId),
        eq(agentTokens.workspaceId, input.workspaceId),
        isNull(agentTokens.revokedAt),
      ),
    );
}
