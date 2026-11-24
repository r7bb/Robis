import {
  type Database,
  NOTIFY_SPACE_JOB,
  notify,
  type SpaceJob,
  spaceReplies,
  spaceThreads,
  users,
  workspaceMembers,
} from '@robis/database';
import { and, eq, inArray } from 'drizzle-orm';
import type { JobHandler } from './runner.ts';

/** How much of a reply a notification quotes. */
const EXCERPT_LENGTH = 140;

type Reply = {
  id: string;
  body: string;
  authorId: string;
  parentId: string | null;
  deletedAt: Date | null;
  workspaceId: string;
  threadId: string;
  threadTitle: string;
  threadAuthorId: string;
  solvedReplyId: string | null;
};

async function replyOf(db: Database, replyId: string): Promise<Reply | null> {
  const [row] = await db
    .select({
      id: spaceReplies.id,
      body: spaceReplies.body,
      authorId: spaceReplies.authorId,
      parentId: spaceReplies.parentId,
      deletedAt: spaceReplies.deletedAt,
      workspaceId: spaceReplies.workspaceId,
      threadId: spaceThreads.id,
      threadTitle: spaceThreads.title,
      threadAuthorId: spaceThreads.authorId,
      solvedReplyId: spaceThreads.solvedReplyId,
    })
    .from(spaceReplies)
    .innerJoin(spaceThreads, eq(spaceThreads.id, spaceReplies.threadId))
    .where(eq(spaceReplies.id, replyId))
    .limit(1);
  return row ?? null;
}

/** Of these, the people (not agents) still in the workspace, without whoever did it. */
async function peopleToTell(
  db: Database,
  workspaceId: string,
  userIds: readonly string[],
  actorId: string,
) {
  const asked = [...new Set(userIds)].filter((id) => id !== actorId);
  if (asked.length === 0) return [];
  const rows = await db
    .select({ id: users.id })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        inArray(workspaceMembers.userId, asked),
        eq(users.kind, 'human'),
      ),
    );
  return rows.map((row) => row.id);
}

async function parentAuthor(db: Database, parentId: string | null): Promise<string[]> {
  if (!parentId) return [];
  const [row] = await db
    .select({ authorId: spaceReplies.authorId, deletedAt: spaceReplies.deletedAt })
    .from(spaceReplies)
    .where(eq(spaceReplies.id, parentId))
    .limit(1);
  return row && !row.deletedAt ? [row.authorId] : [];
}

/** Who hears of this, and as what; nothing when the news is stale. */
async function recipients(db: Database, job: SpaceJob, reply: Reply) {
  if (job.event === 'answer') {
    // Unmarked, or another reply marked, before this ran: say nothing.
    if (reply.solvedReplyId !== reply.id) return null;
    return { kind: 'space_answer' as const, userIds: [reply.authorId] };
  }
  const parent = await parentAuthor(db, reply.parentId);
  return { kind: 'space_reply' as const, userIds: [reply.threadAuthorId, ...parent] };
}

/**
 * Tell people what happened in a space. Each reply tells each person once,
 * and a reply marked as the answer tells its author once ever, however many
 * times it is unmarked and marked again.
 */
export const notifySpace: JobHandler = async (payload, { db }: { db: Database }) => {
  const job = (payload ?? {}) as Partial<SpaceJob>;
  if (!job.replyId || !job.actorId || (job.event !== 'reply' && job.event !== 'answer')) {
    throw new Error(`${NOTIFY_SPACE_JOB}: replyId, event and actorId are required`);
  }
  const full = job as SpaceJob;
  const reply = await replyOf(db, full.replyId);
  if (!reply || reply.deletedAt) return;
  const who = await recipients(db, full, reply);
  if (!who) return;
  const people = await peopleToTell(db, reply.workspaceId, who.userIds, full.actorId);
  await notify(
    db,
    people.map((userId) => ({
      userId,
      workspaceId: reply.workspaceId,
      actorId: full.actorId,
      kind: who.kind,
      entityType: 'space_reply',
      entityId: reply.id,
      dedupeKey: `${who.kind}:${reply.id}`,
      payload: {
        threadId: reply.threadId,
        replyId: reply.id,
        title: reply.threadTitle,
        ...(who.kind === 'space_reply' ? { excerpt: reply.body.slice(0, EXCERPT_LENGTH) } : {}),
      },
    })),
  );
};
