import { deleteExpiredAuthTokens, deleteExpiredSessions } from '@robis/auth';
import {
  commentMentions,
  comments,
  type Database,
  deleteExpiredUsernameHolds,
  deleteStaleSignups,
  issues,
  notifications,
  projects,
  workspaceMembers,
} from '@robis/database';
import { and, eq, ne } from 'drizzle-orm';
import { scanNudges } from './nudges.ts';
import type { Handlers } from './runner.ts';

/**
 * Job handlers.
 *
 * Every one of these must be idempotent. The queue is at-least-once: a worker
 * that stalls past the visibility timeout has its job reclaimed and run again,
 * and there is no way to make delivery exactly-once without the handler's
 * cooperation.
 */

export type MentionPayload = { commentId: string };

/**
 * Notify everyone mentioned in a comment.
 *
 * Runs out of band because fan-out cost scales with the number of people
 * mentioned, and because a failure here must not roll back the comment.
 */
export const notifyMentions = async (payload: unknown, { db }: { db: Database }) => {
  const { commentId } = payload as MentionPayload;
  if (!commentId) throw new Error('notify.mentions: commentId is required');

  const [comment] = await db
    .select({
      id: comments.id,
      body: comments.body,
      authorId: comments.authorId,
      workspaceId: comments.workspaceId,
      issueId: comments.issueId,
    })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);

  // The comment was deleted between enqueue and run. Nothing to do, and
  // retrying will never help.
  if (!comment) return;

  // Who the comment meant was decided when it was written (see
  // `comment_mentions`), so a rename in between changes nobody. Only people
  // still in the workspace are told: someone removed since cannot see it.
  const mentioned = await db
    .select({ id: commentMentions.userId })
    .from(commentMentions)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.userId, commentMentions.userId),
        eq(workspaceMembers.workspaceId, comment.workspaceId),
      ),
    )
    .where(
      and(
        eq(commentMentions.commentId, comment.id),
        // Mentioning yourself is not a notification.
        ne(commentMentions.userId, comment.authorId),
      ),
    );
  if (mentioned.length === 0) return;

  const [issue] = await db
    .select({ title: issues.title, number: issues.number, projectId: issues.projectId })
    .from(issues)
    .where(eq(issues.id, comment.issueId))
    .limit(1);

  const [project] = issue
    ? await db
        .select({ key: projects.key })
        .from(projects)
        .where(eq(projects.id, issue.projectId))
        .limit(1)
    : [];

  await db
    .insert(notifications)
    .values(
      mentioned.map((member) => ({
        workspaceId: comment.workspaceId,
        userId: member.id,
        actorId: comment.authorId,
        kind: 'mention',
        entityType: 'comment',
        entityId: comment.id,
        // Keyed on the comment, so a redelivered job is a no-op.
        dedupeKey: `mention:${comment.id}`,
        payload: JSON.stringify({
          issueId: comment.issueId,
          issueKey: project && issue ? `${project.key}-${issue.number}` : null,
          issueTitle: issue?.title ?? null,
          excerpt: comment.body.slice(0, 140),
        }),
      })),
    )
    // Idempotency: a redelivered job must not notify twice. The unique index
    // on (user_id, dedupe_key) is what makes this a no-op.
    .onConflictDoNothing({ target: [notifications.userId, notifications.dedupeKey] });
};

/** Delete session rows that have already expired. */
export const cleanupSessions = async (_payload: unknown, { db }: { db: Database }) => {
  await deleteExpiredSessions(db);
  // Reset and verification tokens expire the same way sessions do, and there
  // is no reason to run a second timer for the same kind of housekeeping.
  await deleteExpiredAuthTokens(db);
  // So do username holds, once their 90 days are up.
  await deleteExpiredUsernameHolds(db);
  // And sign-ups nobody finished, which would otherwise name an address forever.
  await deleteStaleSignups(db);
};

/** Periodic scan that decides who could use a prompt. See `nudges.ts`. */
export const runNudgeScan = async (_payload: unknown, { db }: { db: Database }) => {
  await scanNudges(db);
};

export const handlers: Handlers = {
  'notify.mentions': notifyMentions,
  'sessions.cleanup': cleanupSessions,
  'nudges.scan': runNudgeScan,
};
