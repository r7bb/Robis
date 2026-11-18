import {
  type AssignmentJob,
  channelsFor,
  commentMentions,
  comments,
  type Database,
  issues,
  type MeetingJob,
  meetingAttendees,
  meetings,
  NOTIFY_ASSIGNMENT_JOB,
  NOTIFY_MEETING_JOB,
  notify,
  projects,
  users,
  workspaceMembers,
} from '@robis/database';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Handlers } from './runner.ts';

/**
 * The jobs that tell people things (C3). Each finds who should hear, and
 * hands them to `notify`, which applies their settings and makes each
 * notification at most once, so a redelivered job tells no one twice.
 *
 * Only people are told: an agent has no inbox to read.
 */

type MentionPayload = { commentId: string };

/** Of these users, the people (not agents) still in the workspace. */
async function peopleIn(db: Database, workspaceId: string, userIds: readonly string[]) {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({ id: users.id })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        inArray(workspaceMembers.userId, [...new Set(userIds)]),
        eq(users.kind, 'human'),
      ),
    );
  return rows.map((row) => row.id);
}

/** An issue as a notification names it: its key and title. */
async function issueLabel(db: Database, issueId: string) {
  const [issue] = await db
    .select({
      title: issues.title,
      number: issues.number,
      key: projects.key,
      workspaceId: issues.workspaceId,
      createdBy: issues.createdBy,
      assigneeId: issues.assigneeId,
    })
    .from(issues)
    .innerJoin(projects, eq(projects.id, issues.projectId))
    .where(eq(issues.id, issueId))
    .limit(1);
  return issue ? { ...issue, issueKey: `${issue.key}-${issue.number}` } : null;
}

/**
 * A new comment: everyone it mentions hears of it as a mention, and the
 * person who filed the issue and its assignee as a comment on their issue
 * (unless an agent wrote it). Someone in both hears once, as the mention;
 * the writer hears nothing.
 */
const notifyComment = async (payload: unknown, { db }: { db: Database }) => {
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
  // Deleted between enqueue and run: nothing to do, and retrying never helps.
  if (!comment) return;

  // Who the comment meant was decided when it was written (see
  // `comment_mentions`), so a rename in between changes nobody.
  const mentionedRows = await db
    .select({ id: commentMentions.userId })
    .from(commentMentions)
    .where(
      and(eq(commentMentions.commentId, comment.id), ne(commentMentions.userId, comment.authorId)),
    );
  const issue = await issueLabel(db, comment.issueId);
  const mentioned = await peopleIn(
    db,
    comment.workspaceId,
    mentionedRows.map((r) => r.id),
  );
  // Someone mentioned hears once, as the mention, unless they turned
  // mentions off: then they still hear of a comment on their own issue.
  const mentionChannels = await channelsFor(db, mentioned, 'mention');
  const hearsMention = (id: string) =>
    Object.values(mentionChannels.get(id) ?? {}).some((on) => on);
  // An agent's comment is not news to the issue's people: the triage agent
  // comments on every new issue, so its assignee would hear twice of each.
  // Whoever it mentions is still told.
  const [author] = await db
    .select({ kind: users.kind })
    .from(users)
    .where(eq(users.id, comment.authorId))
    .limit(1);
  const byAgent = author?.kind === 'agent';
  const owners = await peopleIn(
    db,
    comment.workspaceId,
    [byAgent ? null : issue?.createdBy, byAgent ? null : issue?.assigneeId].filter(
      (id): id is string => !!id && id !== comment.authorId && !hearsMention(id),
    ),
  );

  const about = {
    issueId: comment.issueId,
    issueKey: issue?.issueKey ?? null,
    issueTitle: issue?.title ?? null,
    excerpt: comment.body.slice(0, 140),
  };
  const base = {
    workspaceId: comment.workspaceId,
    actorId: comment.authorId,
    entityType: 'comment',
    entityId: comment.id,
    payload: about,
  };
  await notify(
    db,
    mentioned.map((userId) => ({
      ...base,
      userId,
      kind: 'mention',
      // Keyed on the comment, so a redelivered job is a no-op.
      dedupeKey: `mention:${comment.id}`,
    })),
  );
  await notify(
    db,
    owners.map((userId) => ({
      ...base,
      userId,
      kind: 'issue_comment',
      dedupeKey: `issue_comment:${comment.id}`,
    })),
  );
};

/** Someone was given an issue by someone else. */
const notifyAssignment = async (payload: unknown, { db }: { db: Database }) => {
  const job = payload as AssignmentJob;
  if (!job.issueId || !job.assigneeId || !job.eventId) {
    throw new Error(`${NOTIFY_ASSIGNMENT_JOB}: issueId, assigneeId and eventId are required`);
  }
  const issue = await issueLabel(db, job.issueId);
  // Gone, or given to someone else before this ran: the news is stale.
  if (!issue || issue.assigneeId !== job.assigneeId) return;
  const [person] = await peopleIn(db, issue.workspaceId, [job.assigneeId]);
  if (!person) return;

  await notify(db, [
    {
      userId: person,
      workspaceId: issue.workspaceId,
      actorId: job.actorId,
      kind: 'assignment',
      entityType: 'issue',
      entityId: job.issueId,
      dedupeKey: `assignment:${job.eventId}`,
      payload: { issueId: job.issueId, issueKey: issue.issueKey, issueTitle: issue.title },
    },
  ]);
};

/** A meeting moved, changed or was called off: its attendees hear, not whoever did it. */
const notifyMeeting = async (payload: unknown, { db }: { db: Database }) => {
  const job = payload as MeetingJob;
  if (!job.meetingId || !job.change || !job.eventId) {
    throw new Error(`${NOTIFY_MEETING_JOB}: meetingId, change and eventId are required`);
  }
  const [meeting] = await db
    .select({
      title: meetings.title,
      startsAt: meetings.startsAt,
      workspaceId: meetings.workspaceId,
    })
    .from(meetings)
    .where(eq(meetings.id, job.meetingId))
    .limit(1);
  if (!meeting) return;
  const attendees = await db
    .select({ id: meetingAttendees.userId })
    .from(meetingAttendees)
    .where(eq(meetingAttendees.meetingId, job.meetingId));
  const people = await peopleIn(
    db,
    meeting.workspaceId,
    attendees.map((a) => a.id).filter((id) => id !== job.actorId),
  );

  await notify(
    db,
    people.map((userId) => ({
      userId,
      workspaceId: meeting.workspaceId,
      actorId: job.actorId,
      kind: 'meeting',
      entityType: 'meeting',
      entityId: job.meetingId,
      dedupeKey: `meeting:${job.eventId}`,
      payload: {
        meetingId: job.meetingId,
        title: meeting.title,
        startsAt: meeting.startsAt.toISOString(),
        change: job.change,
      },
    })),
  );
};

export const notifyHandlers: Handlers = {
  'notify.mentions': notifyComment,
  [NOTIFY_ASSIGNMENT_JOB]: notifyAssignment,
  [NOTIFY_MEETING_JOB]: notifyMeeting,
};
