import {
  type Database,
  spaceReplies,
  spaceReplyReactions,
  spaces,
  spaceThreads,
  users,
  workspaceMembers,
} from '@robis/database';
import { and, count, desc, eq, gte, isNull, ne, sql } from 'drizzle-orm';
import { excerptOf } from './wire.ts';

/**
 * The most helpful lists: people ranked by the Helpful marks their replies
 * received, then by answers given, and the replies with the most Helpful
 * marks. Marking your own reply helpful, or your own reply as the answer
 * to your own question, counts for nothing here. Only people still in the
 * workspace, and never agents, are ranked, and only their marks count.
 * An answer counts in the week it was marked.
 */

const LEADER_DAYS = { week: 7, month: 30, all: null } as const;
export type LeaderPeriod = keyof typeof LEADER_DAYS;
const PEOPLE_SHOWN = 10;
const REPLIES_SHOWN = 5;
const DAY_MS = 86_400_000;

export function sinceOf(period: LeaderPeriod, now: Date): Date | null {
  const days = LEADER_DAYS[period];
  return days === null ? null : new Date(now.getTime() - days * DAY_MS);
}

/** Marks count only from humans who are members here now. */
const fromMembers = (workspaceId: string) =>
  and(
    eq(workspaceMembers.workspaceId, workspaceId),
    eq(workspaceMembers.userId, spaceReplyReactions.userId),
  );

/** Helpful marks received per author, from someone else, in the period. */
async function helpfulByAuthor(db: Database, workspaceId: string, since: Date | null) {
  return db
    .select({ userId: spaceReplies.authorId, n: count() })
    .from(spaceReplyReactions)
    .innerJoin(spaceReplies, eq(spaceReplies.id, spaceReplyReactions.replyId))
    .innerJoin(workspaceMembers, fromMembers(workspaceId))
    .innerJoin(users, and(eq(users.id, spaceReplyReactions.userId), eq(users.kind, 'human')))
    .where(
      and(
        eq(spaceReplies.workspaceId, workspaceId),
        eq(spaceReplyReactions.reaction, 'helpful'),
        ne(spaceReplyReactions.userId, spaceReplies.authorId),
        isNull(spaceReplies.deletedAt),
        since ? gte(spaceReplyReactions.createdAt, since) : undefined,
      ),
    )
    .groupBy(spaceReplies.authorId);
}

/** Replies marked as the answer to someone else's question, per author, in the period. */
async function answersByAuthor(db: Database, workspaceId: string, since: Date | null) {
  return db
    .select({ userId: spaceReplies.authorId, n: count() })
    .from(spaceThreads)
    .innerJoin(spaceReplies, eq(spaceReplies.id, spaceThreads.solvedReplyId))
    .where(
      and(
        eq(spaceThreads.workspaceId, workspaceId),
        ne(spaceThreads.authorId, spaceReplies.authorId),
        since ? gte(spaceThreads.solvedAt, since) : undefined,
      ),
    )
    .groupBy(spaceReplies.authorId);
}

/** Humans who are members here now. */
async function rankable(db: Database, workspaceId: string) {
  const rows = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(users.kind, 'human')));
  return new Set(rows.map((row) => row.userId));
}

export async function leadingPeople(db: Database, workspaceId: string, since: Date | null) {
  const [helpful, answers, members] = await Promise.all([
    helpfulByAuthor(db, workspaceId, since),
    answersByAuthor(db, workspaceId, since),
    rankable(db, workspaceId),
  ]);
  const tally = new Map<string, { userId: string; helpful: number; answers: number }>();
  const entry = (userId: string) => {
    const found = tally.get(userId) ?? { userId, helpful: 0, answers: 0 };
    tally.set(userId, found);
    return found;
  };
  for (const row of helpful) entry(row.userId).helpful = row.n;
  for (const row of answers) entry(row.userId).answers = row.n;
  return [...tally.values()]
    .filter((person) => members.has(person.userId))
    .sort((a, b) => b.helpful - a.helpful || b.answers - a.answers)
    .slice(0, PEOPLE_SHOWN);
}

export async function leadingReplies(db: Database, workspaceId: string, since: Date | null) {
  const helpful = count(spaceReplyReactions.userId);
  const rows = await db
    .select({
      replyId: spaceReplies.id,
      threadId: spaceThreads.id,
      threadTitle: spaceThreads.title,
      spaceName: spaces.name,
      authorId: spaceReplies.authorId,
      body: spaceReplies.body,
      answer: sql<boolean>`${spaceThreads.solvedReplyId} = ${spaceReplies.id}`,
      helpful,
    })
    .from(spaceReplyReactions)
    .innerJoin(spaceReplies, eq(spaceReplies.id, spaceReplyReactions.replyId))
    .innerJoin(spaceThreads, eq(spaceThreads.id, spaceReplies.threadId))
    .innerJoin(spaces, eq(spaces.id, spaceThreads.spaceId))
    .innerJoin(workspaceMembers, fromMembers(workspaceId))
    .innerJoin(users, and(eq(users.id, spaceReplyReactions.userId), eq(users.kind, 'human')))
    .where(
      and(
        eq(spaceReplies.workspaceId, workspaceId),
        eq(spaceReplyReactions.reaction, 'helpful'),
        ne(spaceReplyReactions.userId, spaceReplies.authorId),
        isNull(spaceReplies.deletedAt),
        since ? gte(spaceReplyReactions.createdAt, since) : undefined,
      ),
    )
    .groupBy(spaceReplies.id, spaceThreads.id, spaces.name)
    .orderBy(desc(helpful), desc(spaceReplies.createdAt))
    .limit(REPLIES_SHOWN);
  return rows.map(({ body, answer, ...row }) => ({
    ...row,
    excerpt: excerptOf(body),
    answer: answer === true,
  }));
}
