import {
  type Database,
  notifications,
  publishEvent,
  queueInvitationMail,
  recordAudit,
  type Tx,
  users,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from '@robis/database';
import { contracts, type InviteMemberInput, MAX_PENDING_INVITATIONS } from '@robis/shared';
import { and, asc, count, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { serve, shape } from '../contract.ts';
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
import {
  addressedTo,
  addresseeOf,
  closeInvitation,
  closeTheRest,
  confirmedAccountFor,
  findMine,
  invitationNotice,
  memberHasEmail,
  senderStillStands,
  usernameOf,
} from './invitation-helpers.ts';
import { assertCanGrant } from './members.ts';

/**
 * Invitations: how someone comes to be in a workspace.
 *
 * An admin asks (`POST /workspaces/:id/members`, the route that used to add
 * people outright), the invited person sees it in their inbox and on their
 * workspaces page, and accepts or declines. Accepting needs a confirmed
 * email address: that is what a verified address gates (ROADMAP item 4).
 *
 * By username, the person is known, as a username is public inside Robis.
 * By email, nothing is said about the address: the answer is the same
 * 202 whether or not it has an account, is already a member or was already
 * asked, an email goes to it either way, and the pending list shows the
 * address as typed. See `invitation-helpers.ts` for how an address finds
 * its account (through that account's confirmed email only).
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

/** Per sender, across every workspace; refused once that many are waiting. */
async function assertSenderHasRoom(tx: Tx, senderId: string) {
  // Counted per invitee, a few throwaway workspaces could fill someone's cap
  // and block a real team's invitation.
  const [outstanding] = await tx
    .select({ n: count() })
    .from(workspaceInvitations)
    .where(eq(workspaceInvitations.invitedBy, senderId));
  if ((outstanding?.n ?? 0) >= MAX_PENDING_INVITATIONS) {
    throw ApiError.conflict(
      `You have ${MAX_PENDING_INVITATIONS} invitations waiting for an answer; withdraw some, or wait for replies`,
      'too_many_invitations',
    );
  }
}

async function workspaceNameOf(tx: Tx, workspaceId: string) {
  const [workspace] = await tx
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return workspace?.name ?? null;
}

export async function invitationRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  /** An existing account, by its username. */
  async function inviteByUsername(
    request: FastifyRequest,
    workspaceId: string,
    input: InviteMemberInput & { username: string },
  ) {
    const actor = currentUser(request);
    const [invitee] = await db
      .select({ id: users.id, name: users.name, username: users.username })
      .from(users)
      .where(eq(users.username, input.username))
      .limit(1);
    if (!invitee) throw ApiError.notFound('No account has that username');

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
      await assertSenderHasRoom(tx, actor.id);

      const [row] = await tx
        .insert(workspaceInvitations)
        .values({ workspaceId, userId: invitee.id, role: input.role, invitedBy: actor.id })
        .onConflictDoNothing()
        .returning();
      if (!row) throw ApiError.conflict('That user is already invited', 'already_invited');

      await tx.insert(notifications).values({
        workspaceId,
        userId: invitee.id,
        actorId: actor.id,
        kind: 'invitation',
        entityType: 'invitation',
        entityId: row.id,
        dedupeKey: invitationNotice(row.id),
        payload: JSON.stringify({
          workspaceName: await workspaceNameOf(tx, workspaceId),
          role: row.role,
        }),
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
        email: null,
        name: invitee.name,
        username: invitee.username,
        role: invitation.role,
        createdAt: invitation.createdAt,
      },
    };
  }

  /**
   * An address, whatever is behind it. Every branch answers the same, and
   * only an invitation that is actually new sends mail, so the response,
   * the mail and the pending list say nothing about the address.
   */
  async function inviteByEmail(
    request: FastifyRequest,
    workspaceId: string,
    input: InviteMemberInput & { email: string },
  ) {
    const actor = currentUser(request);
    const email = input.email.trim().toLowerCase();

    const created = await db.transaction(async (tx) => {
      // Already in under this address: nothing to ask, said the same way.
      if (await memberHasEmail(tx, workspaceId, email)) return null;
      await assertSenderHasRoom(tx, actor.id);

      const [row] = await tx
        .insert(workspaceInvitations)
        .values({ workspaceId, email, role: input.role, invitedBy: actor.id })
        // Asked already: the waiting invitation and its mail stand.
        .onConflictDoNothing()
        .returning();
      if (!row) return null;

      // An inbox notice too, but only for an account that has confirmed
      // this address; an unconfirmed one is only a claim to it.
      const accountId = await confirmedAccountFor(tx, email);
      if (accountId) {
        await tx.insert(notifications).values({
          workspaceId,
          userId: accountId,
          actorId: actor.id,
          kind: 'invitation',
          entityType: 'invitation',
          entityId: row.id,
          dedupeKey: invitationNotice(row.id),
          payload: JSON.stringify({
            workspaceName: await workspaceNameOf(tx, workspaceId),
            role: row.role,
          }),
        });
      }
      await queueInvitationMail(tx, row.id);

      // The trail names people by username, never by address, and this is
      // nobody yet: the invitation is the entity.
      await recordAudit(tx, auditActor(request), {
        workspaceId,
        entityType: 'invitation',
        entityId: row.id,
        eventType: 'member.invited',
        payload: { role: row.role, by: 'email' },
      });
      return row;
    });

    if (created) await publishEvent(db, { type: 'member.changed', workspaceId, actorId: actor.id });
    return { invitation: { email, role: input.role, status: 'sent' as const } };
  }

  serve(
    app,
    contracts['members.invite'],
    {
      preHandler: [
        requireAuth,
        requireMembership(db, 'member:invite'),
        // Inviting needs only a name or an address, and any account can own
        // a workspace, so this is throttled like a lookup rather than trusted.
        rateLimit({ name: 'member-invite', limit: INVITES_PER_MINUTE, windowMs: 60_000 }),
      ],
    },
    async (request, { body: input }, reply) => {
      const route = contracts['members.invite'];
      const { workspaceId, role: actorRole } = currentMembership(request);
      assertCanGrant(actorRole, input.role);

      if (input.email) {
        const email = input.email;
        return withIdempotency(db, request, reply, 202, async () =>
          shape(route, await inviteByEmail(request, workspaceId, { ...input, email })),
        );
      }
      const username = input.username as string;
      return withIdempotency(db, request, reply, 201, async () =>
        shape(route, await inviteByUsername(request, workspaceId, { ...input, username })),
      );
    },
  );

  /**
   * Who has been asked and not answered, for the people who may ask: by
   * username, or the address as typed. An address is never shown as the
   * account it turned out to be.
   */
  serve(
    app,
    contracts['invitations.sent'],
    { preHandler: [requireAuth, requireMembership(db, 'member:invite')] },
    async (request) => {
      const { workspaceId } = currentMembership(request);
      const rows = await db
        .select({
          id: workspaceInvitations.id,
          userId: workspaceInvitations.userId,
          email: workspaceInvitations.email,
          name: users.name,
          username: users.username,
          role: workspaceInvitations.role,
          createdAt: workspaceInvitations.createdAt,
        })
        .from(workspaceInvitations)
        .leftJoin(users, eq(users.id, workspaceInvitations.userId))
        .where(eq(workspaceInvitations.workspaceId, workspaceId))
        .orderBy(asc(workspaceInvitations.createdAt));
      return { invitations: rows };
    },
  );

  /** Withdraw an invitation that has not been answered. */
  serve(
    app,
    contracts['invitations.withdraw'],
    { preHandler: [requireAuth, requireMembership(db, 'member:invite')] },
    async (request, { params: { invitationId } }, reply) => {
      const actor = currentUser(request);
      const { workspaceId, role: actorRole } = currentMembership(request);

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
            .limit(1)
            .catch(() => []);
          if (!invitation) throw ApiError.notFound('Invitation not found');
          // Withdrawing is the same authority as sending: not above your own.
          assertCanGrant(actorRole, invitation.role);

          await closeInvitation(tx, invitation.id, { workspaceId });
          const username = await usernameOf(tx, invitation.userId);
          await recordAudit(tx, auditActor(request), {
            workspaceId,
            entityType: invitation.userId ? 'member' : 'invitation',
            entityId: invitation.userId ?? invitation.id,
            eventType: 'member.invite_revoked',
            payload: { role: invitation.role },
            personal:
              username && invitation.userId
                ? { subjectId: invitation.userId, fields: { username } }
                : undefined,
          });
        });
        await publishEvent(db, { type: 'member.changed', workspaceId, actorId: actor.id });
        return undefined;
      });
    },
  );

  /** The invitations waiting for you, from any workspace. */
  serve(app, contracts['invitations.mine'], { preHandler: requireAuth }, async (request) => {
    const addressee = await addresseeOf(db, currentUser(request).id);
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
      .where(addressedTo(addressee))
      .orderBy(asc(workspaceInvitations.createdAt));

    return {
      invitations: rows.map(({ workspaceId, workspaceName, ...row }) => ({
        ...row,
        workspace: { id: workspaceId, name: workspaceName },
      })),
    };
  });

  serve(
    app,
    contracts['invitations.accept'],
    { preHandler: requireAuth },
    async (request, { params: { invitationId } }, reply) => {
      const user = currentUser(request);

      return withIdempotency(db, request, reply, 200, async () => {
        const addressee = await addresseeOf(db, user.id);
        // Found before the address is checked, so someone else's invitation
        // is a 404 whatever the state of your own account.
        if (!(await findMine(db, invitationId, addressee))) {
          throw ApiError.notFound('Invitation not found');
        }
        if (!addressee.confirmedEmail) {
          throw new ApiError(
            403,
            'email_unverified',
            'Confirm your email address before joining a workspace',
          );
        }
        // Joining is using a workspace, so it waits for the current terms.
        assertHasAgreed(user);

        const joined = await db.transaction(async (tx) => {
          const invitation = await closeInvitation(tx, invitationId, { addressee });
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
            .values({ workspaceId: invitation.workspaceId, userId: user.id, role: invitation.role })
            .onConflictDoNothing({
              target: [workspaceMembers.workspaceId, workspaceMembers.userId],
            })
            .returning({ role: workspaceMembers.role });
          await closeTheRest(tx, invitation.workspaceId, addressee);

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
        return shape(contracts['invitations.accept'], joined);
      });
    },
  );

  serve(
    app,
    contracts['invitations.decline'],
    { preHandler: requireAuth },
    async (request, { params: { invitationId } }, reply) => {
      const user = currentUser(request);

      return withIdempotency(db, request, reply, 204, async () => {
        const addressee = await addresseeOf(db, user.id);
        const workspaceId = await db.transaction(async (tx) => {
          const invitation = await findMine(tx, invitationId, addressee);
          if (!invitation) throw ApiError.notFound('Invitation not found');

          await closeInvitation(tx, invitation.id, { addressee });
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
