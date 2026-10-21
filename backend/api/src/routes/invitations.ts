import {
  type Database,
  notifications,
  publishEvent,
  recordAudit,
  type Tx,
  users,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from '@robis/database';
import { can, inviteMemberSchema, isUuid, MAX_PENDING_INVITATIONS, rankOf } from '@robis/shared';
import { and, asc, count, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError } from '../errors.ts';
import {
  assertHasAgreed,
  auditActor,
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';
import { withIdempotency } from '../plugins/idempotency.ts';
import { rateLimit } from '../plugins/rate-limit.ts';
import { parse } from '../validate.ts';
import { assertCanGrant } from './members.ts';

/**
 * Invitations: how someone comes to be in a workspace.
 *
 * An admin asks (`POST /workspaces/:id/members`, the route that used to add
 * people outright), the invited person sees it in their inbox and on their
 * workspaces page, and accepts or declines. Accepting needs a confirmed
 * email address: that is what a verified address gates (ROADMAP item 4).
 *
 * Seeing and answering your own invitations needs no picture, as leaving
 * a workspace needs none: the picture gate is on using a workspace, and it
 * still holds there after you join.
 *
 * Every write is audited in the same transaction and goes through the
 * idempotency ledger. Someone else's invitation is a 404 to everyone else,
 * like a workspace you are not in.
 */

/** Generous for a person setting up a team, tight for anyone sweeping names. */
const INVITES_PER_MINUTE = 30;

const invitationNotice = (invitationId: string) => `invitation:${invitationId}`;

/** The invitation, if it is addressed to this person; otherwise nothing. */
async function findMine(db: Database | Tx, invitationId: string, userId: string) {
  if (!isUuid(invitationId)) return null;
  const [row] = await db
    .select()
    .from(workspaceInvitations)
    .where(and(eq(workspaceInvitations.id, invitationId), eq(workspaceInvitations.userId, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * Remove an answered or withdrawn invitation, and the notice that announced
 * it. Scoped to whose it is, so a wrong id deletes nothing.
 */
async function closeInvitation(
  tx: Tx,
  invitationId: string,
  scope: { userId: string } | { workspaceId: string },
) {
  const [closed] = await tx
    .delete(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.id, invitationId),
        'userId' in scope
          ? eq(workspaceInvitations.userId, scope.userId)
          : eq(workspaceInvitations.workspaceId, scope.workspaceId),
      ),
    )
    .returning();
  if (closed) {
    await tx
      .delete(notifications)
      .where(
        and(
          eq(notifications.userId, closed.userId),
          eq(notifications.dedupeKey, invitationNotice(invitationId)),
        ),
      );
  }
  return closed ?? null;
}

/**
 * Whether the person who sent an invitation could still send it: still a
 * member, still allowed to invite, and still ranked at least as high as
 * the role offered. An invitation is only as good as its sender's word.
 */
async function senderStillStands(tx: Tx, invitation: typeof workspaceInvitations.$inferSelect) {
  if (!invitation.invitedBy) return false;
  const [sender] = await tx
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, invitation.workspaceId),
        eq(workspaceMembers.userId, invitation.invitedBy),
      ),
    )
    .limit(1);
  return (
    Boolean(sender) &&
    can(sender!.role, 'member:invite') &&
    rankOf(invitation.role) <= rankOf(sender!.role)
  );
}

async function usernameOf(db: Database | Tx, userId: string) {
  const [row] = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.username ?? null;
}

export async function invitationRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  /** Invite an existing account, by username or by the email you know. */
  app.post(
    '/workspaces/:workspaceId/members',
    {
      preHandler: [
        requireAuth,
        requireMembership(db, 'member:invite'),
        // Inviting needs only a username, and any account can own a
        // workspace, so this is throttled like a lookup rather than trusted.
        rateLimit({ name: 'member-invite', limit: INVITES_PER_MINUTE, windowMs: 60_000 }),
      ],
    },
    async (request, reply) => {
      const actor = currentUser(request);
      const { workspaceId, role: actorRole } = currentMembership(request);
      const input = parse(inviteMemberSchema, request.body);

      assertCanGrant(actorRole, input.role);

      const [invitee] = await db
        .select({ id: users.id, email: users.email, name: users.name, username: users.username })
        .from(users)
        .where(
          input.username
            ? eq(users.username, input.username)
            : eq(users.email, input.email as string),
        )
        .limit(1);

      if (!invitee) {
        throw ApiError.notFound(
          input.username ? 'No account has that username' : 'No account exists with that email',
        );
      }

      return withIdempotency(db, request, reply, 201, async () => {
        const invitation = await db.transaction(async (tx) => {
          const [member] = await tx
            .select({ userId: workspaceMembers.userId })
            .from(workspaceMembers)
            .where(
              and(
                eq(workspaceMembers.workspaceId, workspaceId),
                eq(workspaceMembers.userId, invitee.id),
              ),
            )
            .limit(1);
          if (member) throw ApiError.conflict('That user is already a member', 'already_member');

          const [waiting] = await tx
            .select({ n: count() })
            .from(workspaceInvitations)
            .where(eq(workspaceInvitations.userId, invitee.id));
          if ((waiting?.n ?? 0) >= MAX_PENDING_INVITATIONS) {
            throw ApiError.conflict(
              'That person has too many invitations waiting already',
              'too_many_invitations',
            );
          }

          const [row] = await tx
            .insert(workspaceInvitations)
            .values({ workspaceId, userId: invitee.id, role: input.role, invitedBy: actor.id })
            .onConflictDoNothing({
              target: [workspaceInvitations.workspaceId, workspaceInvitations.userId],
            })
            .returning();
          if (!row) throw ApiError.conflict('That user is already invited', 'already_invited');

          const [workspace] = await tx
            .select({ name: workspaces.name })
            .from(workspaces)
            .where(eq(workspaces.id, workspaceId))
            .limit(1);

          await tx.insert(notifications).values({
            workspaceId,
            userId: invitee.id,
            actorId: actor.id,
            kind: 'invitation',
            entityType: 'invitation',
            entityId: row.id,
            dedupeKey: invitationNotice(row.id),
            payload: JSON.stringify({ workspaceName: workspace?.name ?? null, role: row.role }),
          });

          await recordAudit(tx, auditActor(request), {
            workspaceId,
            entityType: 'member',
            entityId: invitee.id,
            eventType: 'member.invited',
            payload: { role: row.role },
            // Who it was, kept where an erasure request can reach it.
            personal: { subjectId: invitee.id, fields: { username: invitee.username } },
          });

          return row;
        });

        await publishEvent(db, { type: 'member.changed', workspaceId, actorId: actor.id });

        return {
          invitation: {
            id: invitation.id,
            userId: invitee.id,
            // Only the address the inviter already typed. Inviting by username
            // must not turn into a way to look up anyone's email: any account
            // can create a workspace and so hold `member:invite` somewhere.
            email: input.email ? invitee.email : null,
            name: invitee.name,
            username: invitee.username,
            role: invitation.role,
            createdAt: invitation.createdAt,
          },
        };
      });
    },
  );

  /** Who has been asked and not answered, for the people who may ask. */
  app.get(
    '/workspaces/:workspaceId/invitations',
    { preHandler: [requireAuth, requireMembership(db, 'member:invite')] },
    async (request) => {
      const { workspaceId } = currentMembership(request);
      const rows = await db
        .select({
          id: workspaceInvitations.id,
          userId: workspaceInvitations.userId,
          name: users.name,
          username: users.username,
          role: workspaceInvitations.role,
          createdAt: workspaceInvitations.createdAt,
        })
        .from(workspaceInvitations)
        .innerJoin(users, eq(users.id, workspaceInvitations.userId))
        .where(eq(workspaceInvitations.workspaceId, workspaceId))
        .orderBy(asc(workspaceInvitations.createdAt));
      return { invitations: rows };
    },
  );

  /** Withdraw an invitation that has not been answered. */
  app.delete(
    '/workspaces/:workspaceId/invitations/:invitationId',
    { preHandler: [requireAuth, requireMembership(db, 'member:invite')] },
    async (request, reply) => {
      const actor = currentUser(request);
      const { workspaceId, role: actorRole } = currentMembership(request);
      const { invitationId } = request.params as { invitationId: string };
      if (!isUuid(invitationId)) throw ApiError.notFound('Invitation not found');

      return withIdempotency(db, request, reply, 204, async () => {
        await db.transaction(async (tx) => {
          const [invitation] = await tx
            .select()
            .from(workspaceInvitations)
            .where(
              and(
                eq(workspaceInvitations.id, invitationId),
                eq(workspaceInvitations.workspaceId, workspaceId),
              ),
            )
            .limit(1);
          if (!invitation) throw ApiError.notFound('Invitation not found');
          // Withdrawing is the same authority as sending: not above your own.
          assertCanGrant(actorRole, invitation.role);

          await closeInvitation(tx, invitation.id, { workspaceId });
          const username = await usernameOf(tx, invitation.userId);
          await recordAudit(tx, auditActor(request), {
            workspaceId,
            entityType: 'member',
            entityId: invitation.userId,
            eventType: 'member.invite_revoked',
            payload: { role: invitation.role },
            personal: username ? { subjectId: invitation.userId, fields: { username } } : undefined,
          });
        });
        await publishEvent(db, { type: 'member.changed', workspaceId, actorId: actor.id });
        return undefined;
      });
    },
  );

  /** The invitations waiting for you, from any workspace. */
  app.get('/invitations', { preHandler: requireAuth }, async (request) => {
    const user = currentUser(request);
    const rows = await db
      .select({
        id: workspaceInvitations.id,
        role: workspaceInvitations.role,
        createdAt: workspaceInvitations.createdAt,
        workspaceId: workspaces.id,
        workspaceName: workspaces.name,
        invitedBy: users.username,
      })
      .from(workspaceInvitations)
      .innerJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspaceId))
      .leftJoin(users, eq(users.id, workspaceInvitations.invitedBy))
      .where(eq(workspaceInvitations.userId, user.id))
      .orderBy(asc(workspaceInvitations.createdAt));

    return {
      invitations: rows.map(({ workspaceId, workspaceName, ...row }) => ({
        ...row,
        workspace: { id: workspaceId, name: workspaceName },
      })),
    };
  });

  /** Whether this account's address is confirmed; accepting needs it. */
  async function assertVerified(request: FastifyRequest) {
    const [row] = await db
      .select({ verifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, currentUser(request).id))
      .limit(1);
    if (!row?.verifiedAt) {
      throw new ApiError(
        403,
        'email_unverified',
        'Confirm your email address before joining a workspace',
      );
    }
  }

  app.post(
    '/invitations/:invitationId/accept',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = currentUser(request);
      const { invitationId } = request.params as { invitationId: string };

      return withIdempotency(db, request, reply, 200, async () => {
        // Found before the address is checked, so someone else's invitation
        // is a 404 whatever the state of your own account.
        if (!(await findMine(db, invitationId, user.id))) {
          throw ApiError.notFound('Invitation not found');
        }
        await assertVerified(request);
        // Joining is using a workspace, so it waits for the current terms.
        assertHasAgreed(user);

        const joined = await db.transaction(async (tx) => {
          const invitation = await closeInvitation(tx, invitationId, { userId: user.id });
          // Withdrawn or answered in the meantime.
          if (!invitation) throw ApiError.notFound('Invitation not found');

          const personal = { subjectId: user.id, fields: { username: user.username } };
          if (!(await senderStillStands(tx, invitation))) {
            // Closed, and said so in the trail, but nobody joins on it.
            await recordAudit(tx, auditActor(request), {
              workspaceId: invitation.workspaceId,
              entityType: 'member',
              entityId: user.id,
              eventType: 'member.invite_lapsed',
              payload: { role: invitation.role },
              personal,
            });
            return null;
          }

          const [added] = await tx
            .insert(workspaceMembers)
            .values({
              workspaceId: invitation.workspaceId,
              userId: user.id,
              role: invitation.role,
            })
            .onConflictDoNothing({
              target: [workspaceMembers.workspaceId, workspaceMembers.userId],
            })
            .returning({ role: workspaceMembers.role });

          // Read before the audit write, which takes the chain's lock and so
          // goes last in the transaction (see `recordAudit`).
          const [workspace] = await tx
            .select({ id: workspaces.id, name: workspaces.name })
            .from(workspaces)
            .where(eq(workspaces.id, invitation.workspaceId))
            .limit(1);

          // Already in by some other path: nothing joined, nothing to record.
          if (added) {
            await recordAudit(tx, auditActor(request), {
              workspaceId: invitation.workspaceId,
              entityType: 'member',
              entityId: user.id,
              eventType: 'member.joined',
              payload: { role: invitation.role },
              personal,
            });
          }
          return { workspace: workspace!, role: added?.role ?? invitation.role };
        });

        if (!joined) {
          throw new ApiError(
            404,
            'invitation_lapsed',
            'This invitation no longer stands: whoever sent it can no longer invite',
          );
        }

        await publishEvent(db, {
          type: 'member.changed',
          workspaceId: joined.workspace.id,
          actorId: user.id,
        });
        return joined;
      });
    },
  );

  app.post(
    '/invitations/:invitationId/decline',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = currentUser(request);
      const { invitationId } = request.params as { invitationId: string };

      return withIdempotency(db, request, reply, 204, async () => {
        const workspaceId = await db.transaction(async (tx) => {
          const invitation = await findMine(tx, invitationId, user.id);
          if (!invitation) throw ApiError.notFound('Invitation not found');

          await closeInvitation(tx, invitation.id, { userId: user.id });
          await recordAudit(tx, auditActor(request), {
            workspaceId: invitation.workspaceId,
            entityType: 'member',
            entityId: user.id,
            eventType: 'member.invite_declined',
            payload: { role: invitation.role },
            personal: { subjectId: user.id, fields: { username: user.username } },
          });
          return invitation.workspaceId;
        });

        await publishEvent(db, { type: 'member.changed', workspaceId, actorId: user.id });
        return undefined;
      });
    },
  );
}
