import { randomBytes, randomUUID } from 'node:crypto';
import { issueAgentToken, revokeAgentToken, revokeAllAgentTokens } from '@robis/auth';
import {
  agentTokens,
  type Database,
  lockUsername,
  publishEvent,
  recordAudit,
  type Tx,
  usernameClaim,
  users,
  workspaceMembers,
} from '@robis/database';
import { AGENT_ROLES, type AgentRole, contracts, isUuid, usernameProblem } from '@robis/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import { avatarOf } from '../media/avatars.ts';
import {
  auditActor,
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';

/**
 * Agents as teammates (B5): admins add an agent to a workspace with a role
 * of member or guest, and give it tokens, each shown once. Every change is
 * in the audit trail, named by the agent's username, and goes through the
 * idempotency ledger when the caller sends a key.
 */

/** An agent's address: unique, never deliverable, never typed by anyone. */
const agentEmail = (id: string) => `agent.${id}@agents.robis.invalid`;

/** No password hashes to this: an agent has nothing to sign in with. */
const NO_PASSWORD = '!agent';

/** Tries at a free username before giving up. */
const USERNAME_ATTEMPTS = 6;

/** `Triage bot` becomes `triage.bot`; a clash gets a short random suffix. */
function usernameCandidates(name: string): string[] {
  const base =
    name
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '')
      .slice(0, 20)
      .replace(/\.+$/, '') || 'agent';
  const named = base.endsWith('bot') ? base : `${base}.bot`;
  return [
    named,
    ...Array.from(
      { length: USERNAME_ATTEMPTS - 1 },
      () => `${named}.${randomBytes(2).toString('hex')}`,
    ),
  ].filter((candidate) => usernameProblem(candidate) === null);
}

async function freeUsername(tx: Tx, name: string): Promise<string> {
  for (const candidate of usernameCandidates(name)) {
    await lockUsername(tx, candidate);
    if ((await usernameClaim(tx, candidate, null)) === 'free') return candidate;
  }
  throw ApiError.conflict(
    'Could not find a free username for that name; try another',
    'username_taken',
  );
}

/** The agent named in the path, if it is one in this workspace. */
async function findAgent(db: Database | Tx, workspaceId: string, agentId: string) {
  if (!isUuid(agentId)) return null;
  const [row] = await db
    .select({ id: users.id, username: users.username, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, agentId),
        eq(users.kind, 'agent'),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function agentRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;
  const manage = { preHandler: [requireAuth, requireMembership(db, 'agent:manage')] };

  serve(app, contracts['agents.list'], manage, async (request) => {
    const { workspaceId } = currentMembership(request);

    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
        role: workspaceMembers.role,
        createdAt: workspaceMembers.createdAt,
        avatarKind: users.avatarKind,
        avatarRef: users.avatarRef,
        avatarUpdatedAt: users.avatarUpdatedAt,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(users.kind, 'agent')))
      .orderBy(workspaceMembers.createdAt);

    const tokens = rows.length
      ? await db
          .select({
            id: agentTokens.id,
            agentId: agentTokens.agentId,
            label: agentTokens.label,
            createdAt: agentTokens.createdAt,
            expiresAt: agentTokens.expiresAt,
            revokedAt: agentTokens.revokedAt,
            lastUsedAt: agentTokens.lastUsedAt,
          })
          .from(agentTokens)
          .where(
            and(
              eq(agentTokens.workspaceId, workspaceId),
              inArray(
                agentTokens.agentId,
                rows.map((row) => row.id),
              ),
            ),
          )
          .orderBy(agentTokens.createdAt)
      : [];

    return {
      agents: rows.map(({ avatarKind, avatarRef, avatarUpdatedAt, role, ...agent }) => ({
        ...agent,
        role: role as AgentRole,
        avatar: avatarOf({ id: agent.id, avatarKind, avatarRef, avatarUpdatedAt }),
        tokens: tokens
          .filter((token) => token.agentId === agent.id)
          .map(({ agentId: _agentId, ...token }) => token),
      })),
    };
  });

  /*
   * The two answers that carry a token's secret stay out of the idempotency
   * ledger: it stores each answer to replay it, and the secret must exist
   * nowhere but in the one answer that shows it (it is kept only as a hash).
   * A retried request makes a second token, which an admin can see listed
   * and revoke; a stored secret could be read by anyone with the database.
   */
  serve(app, contracts['agents.create'], manage, async (request, { body: input }) => {
    const actor = currentUser(request);
    const { workspaceId } = currentMembership(request);

    const created = await db.transaction(async (tx) => {
      const id = randomUUID();
      const username = await freeUsername(tx, input.name);
      const [agent] = await tx
        .insert(users)
        .values({
          id,
          kind: 'agent',
          email: agentEmail(id),
          name: input.name,
          username,
          passwordHash: NO_PASSWORD,
          // Drawn from the account id, so the same agent always looks the same.
          avatarKind: 'generated',
          avatarRef: id,
          avatarUpdatedAt: new Date(),
          usernameConfirmedAt: new Date(),
        })
        .returning();
      const [membership] = await tx
        .insert(workspaceMembers)
        .values({ workspaceId, userId: id, role: input.role })
        .returning({ createdAt: workspaceMembers.createdAt });
      const token = await issueAgentToken(tx, {
        agentId: id,
        workspaceId,
        createdBy: actor.id,
        label: input.tokenLabel,
      });

      await recordAudit(tx, auditActor(request), {
        workspaceId,
        entityType: 'agent',
        entityId: id,
        eventType: 'agent.created',
        payload: { username, role: input.role },
      });

      return { agent: agent!, joinedAt: membership!.createdAt, token };
    });

    await publishEvent(db, { type: 'member.changed', workspaceId, actorId: actor.id });

    const { agent, joinedAt, token } = created;
    return {
      agent: {
        id: agent.id,
        name: agent.name,
        username: agent.username,
        role: input.role,
        avatar: avatarOf(agent),
        createdAt: joinedAt,
      },
      token: { id: token.id, label: input.tokenLabel, secret: token.secret },
    };
  });

  serve(
    app,
    contracts['agents.issueToken'],
    manage,
    async (request, { params: { agentId }, body: input }) => {
      const actor = currentUser(request);
      const { workspaceId } = currentMembership(request);

      const agent = await findAgent(db, workspaceId, agentId);
      if (!agent) throw ApiError.notFound('Agent not found');

      const token = await db.transaction(async (tx) => {
        const issued = await issueAgentToken(tx, {
          agentId: agent.id,
          workspaceId,
          createdBy: actor.id,
          label: input.label,
        });
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'agent',
          entityId: agent.id,
          eventType: 'agent.token_issued',
          payload: { username: agent.username, label: input.label },
        });
        return issued;
      });
      return { token: { id: token.id, label: input.label, secret: token.secret } };
    },
  );

  serve(
    app,
    contracts['agents.revokeToken'],
    manage,
    async (request, { params: { agentId, tokenId } }) => {
      const { workspaceId } = currentMembership(request);

      const agent = await findAgent(db, workspaceId, agentId);
      if (!agent || !isUuid(tokenId)) throw ApiError.notFound('Token not found');

      await db.transaction(async (tx) => {
        const revoked = await revokeAgentToken(tx, { tokenId, agentId: agent.id, workspaceId });
        if (!revoked) throw ApiError.notFound('Token not found');
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'agent',
          entityId: agent.id,
          eventType: 'agent.token_revoked',
          payload: { username: agent.username },
        });
      });
      return undefined;
    },
  );

  serve(app, contracts['agents.remove'], manage, async (request, { params: { agentId } }) => {
    const actor = currentUser(request);
    const { workspaceId } = currentMembership(request);

    const agent = await findAgent(db, workspaceId, agentId);
    if (!agent) throw ApiError.notFound('Agent not found');

    await db.transaction(async (tx) => {
      await revokeAllAgentTokens(tx, { agentId: agent.id, workspaceId });
      await tx
        .delete(workspaceMembers)
        .where(
          and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, agent.id)),
        );
      await recordAudit(tx, auditActor(request), {
        workspaceId,
        entityType: 'agent',
        entityId: agent.id,
        eventType: 'agent.removed',
        payload: { username: agent.username, role: agent.role },
      });
    });

    await publishEvent(db, { type: 'member.changed', workspaceId, actorId: actor.id });
    return undefined;
  });
}

/** For the member routes: an agent's role must stay one an agent may hold. */
export function isAgentRole(role: string): role is AgentRole {
  return (AGENT_ROLES as readonly string[]).includes(role);
}
