import { generateSessionToken, hashPassword } from '@robis/auth';
import {
  attachments,
  authTokens,
  type Database,
  enqueue,
  erasureRequests,
  meetingAttendees,
  mutations,
  notifications,
  queueAttachmentPurge,
  STORAGE_PURGE_JOB,
  sessions,
  type Tx,
  users,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from '@robis/database';
import { deleteAccountSchema } from '@robis/shared';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { confirmPassword } from '../confirm-password.ts';
import { ApiError } from '../errors.ts';
import { currentUser, requireAuth } from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';
import { parse } from '../validate.ts';

/** What a deleted account is called wherever its work still shows. */
export const DELETED_NAME = 'Deleted user';

type Decision = { id: string; action: 'transfer'; to: string } | { id: string; action: 'delete' };

/** Workspaces this person owns with no other owner: each needs a decision. */
async function soleOwnedWorkspaces(db: Database, userId: string) {
  return db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.role, 'OWNER'),
        sql`not exists (select 1 from workspace_members o where o.workspace_id = ${workspaceMembers.workspaceId} and o.role = 'OWNER' and o.user_id <> ${userId})`,
      ),
    );
}

/** Hand a workspace on, or delete it with its files. */
async function settleWorkspace(tx: Tx, userId: string, decision: Decision) {
  if (decision.action === 'transfer') {
    const [heir] = await tx
      .update(workspaceMembers)
      .set({ role: 'OWNER' })
      .where(
        and(
          eq(workspaceMembers.workspaceId, decision.id),
          eq(workspaceMembers.userId, decision.to),
          ne(workspaceMembers.userId, userId),
        ),
      )
      .returning({ userId: workspaceMembers.userId });
    if (!heir) {
      throw ApiError.badRequest(
        'A workspace can only be handed to one of its members',
        'transfer_target_not_member',
      );
    }
    return;
  }
  await queueAttachmentPurge(tx, eq(attachments.workspaceId, decision.id));
  await tx.delete(workspaces).where(eq(workspaces.id, decision.id));
}

/** Empty the account of everything personal; the row stays for its work. */
async function emptyAccount(tx: Tx, userId: string) {
  const [account] = await tx
    .select({ avatarKind: users.avatarKind, avatarRef: users.avatarRef })
    .from(users)
    .where(eq(users.id, userId));
  if (account?.avatarKind === 'photo' && account.avatarRef) {
    await enqueue(tx, STORAGE_PURGE_JOB, { keys: [account.avatarRef] });
  }

  await tx.delete(sessions).where(eq(sessions.userId, userId));
  await tx.delete(authTokens).where(eq(authTokens.userId, userId));
  await tx.delete(workspaceMembers).where(eq(workspaceMembers.userId, userId));
  await tx.delete(workspaceInvitations).where(eq(workspaceInvitations.userId, userId));
  await tx
    .update(workspaceInvitations)
    .set({ invitedBy: null })
    .where(eq(workspaceInvitations.invitedBy, userId));
  await tx.delete(notifications).where(eq(notifications.userId, userId));
  await tx.delete(mutations).where(eq(mutations.userId, userId));
  await tx.delete(meetingAttendees).where(eq(meetingAttendees.userId, userId));

  const tag = userId.replace(/-/g, '');
  await tx
    .update(users)
    .set({
      name: DELETED_NAME,
      email: `deleted+${tag}@robis.invalid`,
      username: `deleted_${tag.slice(0, 20)}`,
      // A password nobody knows, so nothing can sign in as it.
      passwordHash: await hashPassword(generateSessionToken()),
      avatarKind: null,
      avatarRef: null,
      avatarUpdatedAt: null,
      emailVerifiedAt: null,
      ageConfirmedAt: null,
      termsVersion: null,
      termsAcceptedAt: null,
      usernameConfirmedAt: null,
      deletedAt: sql`now()`,
    })
    .where(eq(users.id, userId));
  // The audit trail's personal fields and old usernames are erased by
  // audit:erase's own role, which this request asks for.
  await tx.insert(erasureRequests).values({ subjectId: userId });
}

/**
 * `DELETE /auth/me` (stage 1, item 10). Confirmed with the password; every
 * workspace you alone own needs a decision first (409 lists them); then, in
 * one transaction, each is handed on or deleted with its files, and the
 * account is emptied and an erasure requested. What you wrote in shared
 * workspaces stays, under "Deleted user".
 */
export async function accountDeletionRoutes(
  app: FastifyInstance,
  opts: { db: Database; clearSession: (reply: FastifyReply) => void },
) {
  const { db } = opts;
  app.delete(
    '/auth/me',
    {
      preHandler: [requireAuth, rateLimit({ name: 'account-delete', limit: 10, windowMs: 60_000 })],
    },
    async (request, reply) => {
      const user = currentUser(request);
      const input = parse(deleteAccountSchema, request.body ?? {});
      await confirmPassword(db, user.id, input.password);

      const owned = await soleOwnedWorkspaces(db, user.id);
      const decisions = new Map(input.workspaces.map((d) => [d.id, d as Decision]));
      const undecided = owned.filter((w) => !decisions.has(w.id));
      if (undecided.length > 0) {
        return reply.status(409).send({
          error: 'workspace_decision_needed',
          message: 'Choose what happens to each workspace you alone own first',
          workspaces: undecided,
        });
      }

      await db.transaction(async (tx) => {
        for (const workspace of owned) {
          await settleWorkspace(tx, user.id, decisions.get(workspace.id)!);
        }
        await emptyAccount(tx, user.id);
      });
      opts.clearSession(reply);
      return reply.status(204).send();
    },
  );
}
