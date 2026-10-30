import {
  attachments,
  commentMentions,
  comments,
  type Database,
  enqueue,
  issues,
  publishEvent,
  queueAttachmentPurge,
  recordAudit,
  type Tx,
  users,
  workspaceMembers,
} from '@robis/database';
import { can, contracts, isUuid, parseMentions, resolveMentions } from '@robis/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import {
  auditActor,
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';

/** A mention as the client shows it: what was written, and who it meant. */
export type CommentMention = { handle: string; userId: string; username: string };

/**
 * Decide who a new comment's `@handles` mean, among this workspace's
 * members, and keep it beside the comment. Inside the comment's own
 * transaction, so the two can never disagree about what was said when.
 */
async function recordMentions(
  tx: Tx,
  workspaceId: string,
  commentId: string,
  body: string,
): Promise<CommentMention[]> {
  const handles = parseMentions(body);
  if (handles.length === 0) return [];

  // Only the members a handle could mean, not the whole member list.
  const members = await tx
    .select({ id: users.id, username: users.username })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), inArray(users.username, handles)));

  const mentioned = resolveMentions(body, members);
  if (mentioned.length === 0) return [];

  await tx
    .insert(commentMentions)
    .values(mentioned.map((member) => ({ commentId, userId: member.id, handle: member.username })));
  return mentioned.map((member) => ({
    handle: member.username,
    userId: member.id,
    username: member.username,
  }));
}

/**
 * Each comment's mentions, with the person's username as it is today. A
 * person who has since left the workspace keeps the handle as written:
 * their name now is no business of the people still here.
 */
async function mentionsFor(db: Database, workspaceId: string, commentIds: string[]) {
  const byComment = new Map<string, CommentMention[]>();
  if (commentIds.length === 0) return byComment;

  const rows = await db
    .select({
      commentId: commentMentions.commentId,
      handle: commentMentions.handle,
      userId: commentMentions.userId,
      username: sql<string>`case when ${workspaceMembers.userId} is null then ${commentMentions.handle} else ${users.username} end`,
    })
    .from(commentMentions)
    .innerJoin(users, eq(users.id, commentMentions.userId))
    .leftJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.userId, commentMentions.userId),
        eq(workspaceMembers.workspaceId, workspaceId),
      ),
    )
    .where(inArray(commentMentions.commentId, commentIds));

  for (const { commentId, ...mention } of rows) {
    byComment.set(commentId, [...(byComment.get(commentId) ?? []), mention]);
  }
  return byComment;
}

export async function commentRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  serve(
    app,
    contracts['comments.list'],
    { preHandler: [requireAuth, requireMembership(db, 'comment:read')] },
    async (request, { params: { issueId } }) => {
      const { workspaceId } = currentMembership(request);

      if (!isUuid(issueId)) throw ApiError.notFound('Issue not found');

      const rows = await db
        .select({
          id: comments.id,
          body: comments.body,
          createdAt: comments.createdAt,
          authorId: comments.authorId,
          authorName: users.name,
        })
        .from(comments)
        .innerJoin(users, eq(users.id, comments.authorId))
        .where(and(eq(comments.issueId, issueId), eq(comments.workspaceId, workspaceId)))
        .orderBy(asc(comments.createdAt));

      const mentions = await mentionsFor(
        db,
        workspaceId,
        rows.map((row) => row.id),
      );
      return {
        comments: rows.map((row) => ({ ...row, mentions: mentions.get(row.id) ?? [] })),
      };
    },
  );

  serve(
    app,
    contracts['comments.create'],
    { preHandler: [requireAuth, requireMembership(db, 'comment:create')] },
    async (request, { params: { issueId }, body: input }) => {
      const user = currentUser(request);
      const { workspaceId } = currentMembership(request);

      if (!isUuid(issueId)) throw ApiError.notFound('Issue not found');

      // Confirm the issue is in this workspace before writing; the foreign key
      // alone would happily accept an issue belonging to another tenant.
      const [issue] = await db
        .select({ id: issues.id })
        .from(issues)
        .where(and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)))
        .limit(1);

      if (!issue) throw ApiError.notFound('Issue not found');

      // The insert and the notification job commit together: no window where
      // the comment exists but nobody is told, and no job for a comment that
      // rolled back. This is the reason the queue lives in Postgres.
      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(comments)
          .values({ workspaceId, issueId, authorId: user.id, body: input.body })
          .returning();

        const mentions = await recordMentions(tx, workspaceId, row!.id, input.body);
        await enqueue(tx, 'notify.mentions', { commentId: row!.id });

        // Which issue, not what was said: the comment is the record of its
        // own words, and the trail outlives a deleted comment.
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'comment',
          entityId: row!.id,
          eventType: 'comment.created',
          payload: { issueId },
        });

        return { ...row!, mentions };
      });

      await publishEvent(db, {
        type: 'comment.created',
        workspaceId,
        issueId,
        actorId: user.id,
      });

      return { comment: { ...created, authorName: user.name } };
    },
  );

  /**
   * Deleting your own comment and deleting someone else's are separate
   * permissions, so the check depends on the row -- guests and members can
   * retract what they wrote, only admins can moderate others.
   */
  serve(
    app,
    contracts['comments.delete'],
    { preHandler: [requireAuth, requireMembership(db, 'comment:read')] },
    async (request, { params: { commentId } }) => {
      const user = currentUser(request);
      const { workspaceId, role } = currentMembership(request);

      if (!isUuid(commentId)) throw ApiError.notFound('Comment not found');

      const [comment] = await db
        .select({ id: comments.id, authorId: comments.authorId, issueId: comments.issueId })
        .from(comments)
        .where(and(eq(comments.id, commentId), eq(comments.workspaceId, workspaceId)))
        .limit(1);

      if (!comment) throw ApiError.notFound('Comment not found');

      const isAuthor = comment.authorId === user.id;
      const allowed = isAuthor ? can(role, 'comment:delete_own') : can(role, 'comment:delete_any');

      if (!allowed) throw ApiError.forbidden();

      await db.transaction(async (tx) => {
        await queueAttachmentPurge(tx, eq(attachments.commentId, commentId));

        const deleted = await tx
          .delete(comments)
          .where(and(eq(comments.id, commentId), eq(comments.workspaceId, workspaceId)))
          .returning({ id: comments.id });

        // A concurrent delete got there first and recorded it.
        if (deleted.length === 0) throw ApiError.notFound('Comment not found');

        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'comment',
          entityId: commentId,
          eventType: 'comment.deleted',
          // Moderation is the case an administrator will come looking for.
          payload: { issueId: comment.issueId, authorId: comment.authorId, moderated: !isAuthor },
        });
      });

      return undefined;
    },
  );
}
