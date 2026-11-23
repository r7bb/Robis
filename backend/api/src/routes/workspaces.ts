import {
  attachments,
  auditEvents,
  type Database,
  type Executor,
  messages,
  posts,
  queueAttachmentPurge,
  queueCoverPurge,
  queueMessageImagePurge,
  queuePostPhotoPurge,
  queueStoryPurge,
  recordAudit,
  stories,
  twoFactor,
  users,
  workspaceMembers,
  workspaces,
} from '@robis/database';
import { contracts } from '@robis/shared';

import { and, desc, eq, isNotNull, notLike } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { confirmPassword } from '../confirm-password.ts';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import {
  assertReady,
  auditActor,
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
  requirePicture,
} from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';
import { insertWorkspace } from '../workspaces/create.ts';
import { createDemoWorkspace } from '../workspaces/demo.ts';

/**
 * The admin's own two-factor, read in the transaction that turns the
 * requirement on and held there (C4): one turned off at the same moment
 * cannot leave the workspace requiring what nobody running it has.
 */
async function assertOwnTwoFactorHeld(tx: Executor, userId: string) {
  const [held] = await tx
    .select({ userId: twoFactor.userId })
    .from(twoFactor)
    .where(and(eq(twoFactor.userId, userId), isNotNull(twoFactor.confirmedAt)))
    .for('share');
  if (!held) {
    throw ApiError.conflict(
      'Turn on two-factor sign-in for your own account first, from your account page.',
      'two_factor_needed_first',
    );
  }
}

export async function workspaceRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  serve(
    app,
    contracts['workspaces.list'],
    { preHandler: [requireAuth, requirePicture] },
    async (request) => {
      const user = currentUser(request);

      const rows = await db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          slug: workspaces.slug,
          theme: workspaces.theme,
          demo: workspaces.demo,
          role: workspaceMembers.role,
          createdAt: workspaces.createdAt,
        })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
        .where(eq(workspaceMembers.userId, user.id))
        .orderBy(workspaces.createdAt);

      return { workspaces: rows };
    },
  );

  serve(
    app,
    contracts['workspaces.create'],
    { preHandler: requireAuth },
    async (request, { body: input }) => {
      const user = currentUser(request);
      assertReady(user);

      const workspace = await db.transaction((tx) =>
        insertWorkspace(tx, auditActor(request), user.id, input),
      );

      return { workspace: { ...workspace, role: 'OWNER' as const } };
    },
  );

  // A demo workspace to look around (C5): one per person, so asking again
  // goes back to it. Rate limited as well, since making one writes a few
  // dozen rows.
  serve(
    app,
    contracts['workspaces.createDemo'],
    {
      preHandler: [
        requireAuth,
        requirePicture,
        rateLimit({ name: 'workspace-demo', limit: 10, windowMs: 60_000 }),
      ],
    },
    async (request, { body }) => {
      const user = currentUser(request);
      assertReady(user);
      const { workspace, projectId } = await createDemoWorkspace(db, auditActor(request), user, {
        ...(body.timeZone ? { timeZone: body.timeZone } : {}),
      });
      return { workspace: { ...workspace, role: 'OWNER' as const }, projectId };
    },
  );

  serve(
    app,
    contracts['workspaces.get'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read')] },
    async (request) => {
      const { workspaceId, role } = currentMembership(request);

      const [workspace] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);

      if (!workspace) throw ApiError.notFound('Workspace not found');

      return { workspace: { ...workspace, role } };
    },
  );

  serve(
    app,
    contracts['workspaces.update'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:update')] },
    async (request, { body: input }) => {
      const { workspaceId } = currentMembership(request);

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(workspaces)
          // Spread rather than naming fields: the payload is partial, and
          // Drizzle skips undefined keys, so absent fields stay untouched.
          .set({ ...input, updatedAt: new Date() })
          .where(eq(workspaces.id, workspaceId))
          .returning();

        if (!row) throw ApiError.notFound('Workspace not found');

        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'workspace',
          entityId: workspaceId,
          eventType: 'workspace.updated',
          // Named fields rather than the request body, so a field added to the
          // schema later is not copied into the trail without anyone deciding to.
          payload: { name: row.name, fields: Object.keys(input) },
        });

        return row;
      });

      return { workspace: updated };
    },
  );

  /*
   * Two-factor for everyone (C4): an admin's choice, recorded. Turning it on
   * needs it on the admin's own account, so nobody turns it on and finds
   * themselves outside.
   */
  serve(
    app,
    contracts['workspaces.setTwoFactorRequired'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:update')] },
    async (request, { body: { required } }) => {
      const { workspaceId } = currentMembership(request);
      if (required && !currentUser(request).hasTwoFactor) {
        throw ApiError.conflict(
          'Turn on two-factor sign-in for your own account first, from your account page.',
          'two_factor_needed_first',
        );
      }
      const updated = await db.transaction(async (tx) => {
        // Read again under a lock, so turning theirs off meanwhile waits.
        if (required) await assertOwnTwoFactorHeld(tx, currentUser(request).id);
        const [row] = await tx
          .update(workspaces)
          .set({ requireTwoFactor: required, updatedAt: new Date() })
          .where(eq(workspaces.id, workspaceId))
          .returning();
        if (!row) throw ApiError.notFound('Workspace not found');
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'workspace',
          entityId: workspaceId,
          eventType: 'workspace.two_factor_required',
          payload: { required },
        });
        return row;
      });
      return { workspace: updated };
    },
  );

  serve(
    app,
    contracts['workspaces.delete'],
    {
      preHandler: [
        requireAuth,
        requireMembership(db, 'workspace:delete'),
        // A password check is an Argon2 verify; throttled like sign-in.
        rateLimit({ name: 'workspace-delete', limit: 10, windowMs: 60_000 }),
      ],
    },
    async (request, { body: { password } }) => {
      const { workspaceId } = currentMembership(request);
      // Everything in it goes, for everyone, at once: a session is not
      // enough for that, the password is asked again.
      await confirmPassword(db, currentUser(request).id, password);

      // Projects, issues, comments and memberships go with it via ON DELETE
      // CASCADE, so there is no application-level fan-out to keep in sync.
      // So does the audit trail, which is why this one change records no
      // event: there would be nowhere left to keep it. A SIEM stream is where
      // a deleted workspace's history survives.
      await db.transaction(async (tx) => {
        await queueAttachmentPurge(tx, eq(attachments.workspaceId, workspaceId));
        await queueStoryPurge(tx, eq(stories.workspaceId, workspaceId));
        await queueCoverPurge(tx, eq(workspaceMembers.workspaceId, workspaceId));
        await queueMessageImagePurge(tx, eq(messages.workspaceId, workspaceId));
        await queuePostPhotoPurge(tx, eq(posts.workspaceId, workspaceId));
        await tx.delete(workspaces).where(eq(workspaces.id, workspaceId));
      });

      return undefined;
    },
  );

  serve(
    app,
    contracts['workspaces.activity'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read')] },
    async (request) => {
      const { workspaceId } = currentMembership(request);

      const events = await db
        .select({
          id: auditEvents.id,
          actorId: auditEvents.actorId,
          actorKind: auditEvents.actorKind,
          // Joined rather than stored in the payload: unlike the entities an
          // entry describes, the actor is a real account that still exists,
          // and showing their current name is right when they rename.
          actorName: users.name,
          entityType: auditEvents.entityType,
          entityId: auditEvents.entityId,
          eventType: auditEvents.eventType,
          payload: auditEvents.payload,
          personal: auditEvents.personal,
          createdAt: auditEvents.createdAt,
        })
        .from(auditEvents)
        .leftJoin(users, eq(users.id, auditEvents.actorId))
        // The trail's own housekeeping (who read it, checked it, when it was
        // first signed) is for the Security view, not every member's feed.
        .where(
          and(eq(auditEvents.workspaceId, workspaceId), notLike(auditEvents.eventType, 'audit.%')),
        )
        .orderBy(desc(auditEvents.seq))
        .limit(100);

      // Personal fields (a member's username) are shown with the event until
      // they are erased; after that the entry reads "a member".
      return {
        events: events.map(({ personal, ...e }) => ({
          ...e,
          payload: { ...JSON.parse(e.payload), ...(personal ? JSON.parse(personal) : {}) },
        })),
      };
    },
  );
}
