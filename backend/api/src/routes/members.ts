import {
  type Database,
  type Executor,
  publishEvent,
  recordAudit,
  users,
  workspaceMembers,
} from '@robis/database';
import {
  inviteMemberSchema,
  outranks,
  type Role,
  rankOf,
  setMemberRoleSchema,
} from '@robis/shared';
import { and, count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors.ts';
import {
  auditActor,
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';
import { parse } from '../validate.ts';

async function ownerCount(db: Executor, workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, 'OWNER')));

  return row?.n ?? 0;
}

/**
 * The member's role, plus who they are.
 *
 * The identity is joined here rather than looked up at the call sites because
 * the audit trail needs it: an entry reading "changed a member from admin to
 * member" without naming the member records that something happened and not
 * what. Audit payloads store the values as they were, so the trail stays
 * truthful after the account is renamed or removed.
 */
async function findMember(db: Executor, workspaceId: string, userId: string) {
  const [row] = await db
    .select({ role: workspaceMembers.role, email: users.email, name: users.name })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);

  return row ?? null;
}

/**
 * You may not hand out authority you do not have. An admin promoting someone to
 * owner would be an escalation path around `workspace:delete`.
 */
function assertCanGrant(actor: Role, target: Role) {
  if (rankOf(target) > rankOf(actor)) {
    throw ApiError.forbidden(`You cannot grant a role above your own (${actor})`);
  }
}

/**
 * You may only act on members you outrank. Owners are the exception: they can
 * manage their peers, otherwise a workspace with two owners could never remove
 * either of them.
 */
function assertCanManage(actor: Role, target: Role) {
  if (actor === 'OWNER') return;
  if (!outranks(actor, target)) {
    throw ApiError.forbidden(`You cannot manage a member with the ${target} role`);
  }
}

export async function memberRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  app.get(
    '/workspaces/:workspaceId/members',
    { preHandler: [requireAuth, requireMembership(db, 'member:read')] },
    async (request) => {
      const { workspaceId } = currentMembership(request);

      const members = await db
        .select({
          userId: users.id,
          email: users.email,
          name: users.name,
          role: workspaceMembers.role,
          joinedAt: workspaceMembers.createdAt,
        })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(eq(workspaceMembers.workspaceId, workspaceId))
        .orderBy(workspaceMembers.createdAt);

      return { members };
    },
  );

  /**
   * Adds an existing account to the workspace. Email invitations for people who
   * have not signed up yet need a token flow and an outbound mailer, which
   * belong with the background-worker milestone rather than here.
   */
  app.post(
    '/workspaces/:workspaceId/members',
    { preHandler: [requireAuth, requireMembership(db, 'member:invite')] },
    async (request, reply) => {
      const actor = currentUser(request);
      const { workspaceId, role: actorRole } = currentMembership(request);
      const input = parse(inviteMemberSchema, request.body);

      assertCanGrant(actorRole, input.role);

      const [invitee] = await db
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      if (!invitee) throw ApiError.notFound('No account exists with that email');

      const added = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(workspaceMembers)
          .values({ workspaceId, userId: invitee.id, role: input.role })
          .onConflictDoNothing({
            target: [workspaceMembers.workspaceId, workspaceMembers.userId],
          })
          .returning({ role: workspaceMembers.role });

        if (!row) throw ApiError.conflict('That user is already a member', 'already_member');

        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'member',
          entityId: invitee.id,
          eventType: 'member.added',
          payload: { email: invitee.email, role: input.role },
        });

        return row;
      });

      await publishEvent(db, { type: 'member.changed', workspaceId, actorId: actor.id });

      return reply.status(201).send({
        member: { userId: invitee.id, email: invitee.email, name: invitee.name, role: added.role },
      });
    },
  );

  app.patch(
    '/workspaces/:workspaceId/members/:userId',
    { preHandler: [requireAuth, requireMembership(db, 'member:set_role')] },
    async (request) => {
      const actor = currentUser(request);
      const { workspaceId, role: actorRole } = currentMembership(request);
      const { userId } = request.params as { userId: string };
      const input = parse(setMemberRoleSchema, request.body);

      // Self-service role changes are always an escalation or an accident.
      if (userId === actor.id) {
        throw ApiError.forbidden('You cannot change your own role');
      }

      const target = await findMember(db, workspaceId, userId);
      if (!target) throw ApiError.notFound('That user is not a member of this workspace');

      assertCanManage(actorRole, target.role);
      assertCanGrant(actorRole, input.role);

      // Demoting the last owner would leave the workspace with nobody able to
      // delete it or promote a replacement.
      if (
        target.role === 'OWNER' &&
        input.role !== 'OWNER' &&
        (await ownerCount(db, workspaceId)) <= 1
      ) {
        throw ApiError.conflict('A workspace must keep at least one owner', 'last_owner');
      }

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(workspaceMembers)
          .set({ role: input.role })
          .where(
            and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
          )
          .returning({ role: workspaceMembers.role });

        if (!row) throw ApiError.notFound('That user is not a member of this workspace');

        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'member',
          entityId: userId,
          eventType: 'member.role_changed',
          payload: { email: target.email, name: target.name, from: target.role, to: input.role },
        });

        return row;
      });

      await publishEvent(db, { type: 'member.changed', workspaceId, actorId: actor.id });

      return { member: { userId, role: updated?.role ?? input.role } };
    },
  );

  app.delete(
    '/workspaces/:workspaceId/members/:userId',
    { preHandler: [requireAuth, requireMembership(db, 'member:remove')] },
    async (request, reply) => {
      const actor = currentUser(request);
      const { workspaceId, role: actorRole } = currentMembership(request);
      const { userId } = request.params as { userId: string };

      if (userId === actor.id) {
        throw ApiError.badRequest('Use DELETE /members/me to leave a workspace', 'use_leave');
      }

      const target = await findMember(db, workspaceId, userId);
      if (!target) throw ApiError.notFound('That user is not a member of this workspace');

      assertCanManage(actorRole, target.role);

      if (target.role === 'OWNER' && (await ownerCount(db, workspaceId)) <= 1) {
        throw ApiError.conflict('A workspace must keep at least one owner', 'last_owner');
      }

      await db.transaction(async (tx) => {
        const removed = await tx
          .delete(workspaceMembers)
          .where(
            and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
          )
          .returning({ userId: workspaceMembers.userId });

        if (removed.length === 0) {
          throw ApiError.notFound('That user is not a member of this workspace');
        }

        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'member',
          entityId: userId,
          eventType: 'member.removed',
          payload: { email: target.email, name: target.name, role: target.role },
        });
      });

      return reply.status(204).send();
    },
  );

  /**
   * Leaving is not a privileged action, so it only requires membership -- a
   * guest can walk out. The last owner still cannot, since that would strand
   * the workspace.
   */
  app.delete(
    '/workspaces/:workspaceId/members/me',
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read')] },
    async (request, reply) => {
      const actor = currentUser(request);
      const { workspaceId, role } = currentMembership(request);

      if (role === 'OWNER' && (await ownerCount(db, workspaceId)) <= 1) {
        throw ApiError.conflict(
          'Promote another owner before leaving this workspace',
          'last_owner',
        );
      }

      await db.transaction(async (tx) => {
        const left = await tx
          .delete(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, workspaceId),
              eq(workspaceMembers.userId, actor.id),
            ),
          )
          .returning({ userId: workspaceMembers.userId });

        if (left.length === 0) throw ApiError.notFound('Workspace not found');

        // The actor is the person leaving, so their id is already on the
        // event; the role is the only fact worth adding.
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'member',
          entityId: actor.id,
          eventType: 'member.left',
          payload: { role },
        });
      });

      return reply.status(204).send();
    },
  );
}
