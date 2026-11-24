import {
  type Database,
  spaceReplies,
  spaceReplyReactions,
  spaces,
  spaceThreadReactions,
  spaceThreads,
} from '@robis/database';
import { isUuid, noReactions, type PostReaction } from '@robis/shared';
import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import { ApiError } from '../errors.ts';

/**
 * Spaces as the API shows them: loading one inside the workspace (or 404,
 * never another workspace's), and who reacted how, for a page of threads
 * or replies in one query rather than one per row.
 */

export type SpaceRow = typeof spaces.$inferSelect;
export type ThreadRow = typeof spaceThreads.$inferSelect;
export type ReplyRow = typeof spaceReplies.$inferSelect;
type Reactions = Record<PostReaction, string[]>;

/** The words shown for a thread in a list, or a reply in the most helpful list. */
const EXCERPT_LENGTH = 200;

export function excerptOf(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 1)}…` : flat;
}

export async function spaceIn(db: Database, workspaceId: string, spaceId: string) {
  if (!isUuid(spaceId)) throw ApiError.notFound('Space not found');
  const [row] = await db
    .select()
    .from(spaces)
    .where(and(eq(spaces.id, spaceId), eq(spaces.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw ApiError.notFound('Space not found');
  return row;
}

export async function threadIn(db: Database, workspaceId: string, threadId: string) {
  if (!isUuid(threadId)) throw ApiError.notFound('Thread not found');
  const [row] = await db
    .select()
    .from(spaceThreads)
    .where(and(eq(spaceThreads.id, threadId), eq(spaceThreads.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw ApiError.notFound('Thread not found');
  return row;
}

/** A reply in this workspace, or null: the caller says what was not found. */
export async function replyIn(db: Database, workspaceId: string, replyId: string) {
  if (!isUuid(replyId)) return null;
  const [row] = await db
    .select()
    .from(spaceReplies)
    .where(and(eq(spaceReplies.id, replyId), eq(spaceReplies.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

/** Each thread's reactions, for a page of them. */
async function threadReactions(db: Database, threadIds: string[]) {
  const byId = new Map<string, Reactions>(threadIds.map((id) => [id, noReactions()]));
  if (threadIds.length === 0) return byId;
  const rows = await db
    .select({
      id: spaceThreadReactions.threadId,
      userId: spaceThreadReactions.userId,
      reaction: spaceThreadReactions.reaction,
    })
    .from(spaceThreadReactions)
    .where(inArray(spaceThreadReactions.threadId, threadIds))
    .orderBy(spaceThreadReactions.createdAt);
  for (const row of rows) byId.get(row.id)?.[row.reaction].push(row.userId);
  return byId;
}

/** Each reply's reactions, for a thread's worth. */
export async function replyReactions(db: Database, replyIds: string[]) {
  const byId = new Map<string, Reactions>(replyIds.map((id) => [id, noReactions()]));
  if (replyIds.length === 0) return byId;
  const rows = await db
    .select({
      id: spaceReplyReactions.replyId,
      userId: spaceReplyReactions.userId,
      reaction: spaceReplyReactions.reaction,
    })
    .from(spaceReplyReactions)
    .where(inArray(spaceReplyReactions.replyId, replyIds))
    .orderBy(spaceReplyReactions.createdAt);
  for (const row of rows) byId.get(row.id)?.[row.reaction].push(row.userId);
  return byId;
}

/** How many replies each thread has, not counting any taken down. */
async function replyCounts(db: Database, threadIds: string[]) {
  const byId = new Map<string, number>();
  if (threadIds.length === 0) return byId;
  const rows = await db
    .select({ id: spaceReplies.threadId, n: count() })
    .from(spaceReplies)
    .where(and(inArray(spaceReplies.threadId, threadIds), isNull(spaceReplies.deletedAt)))
    .groupBy(spaceReplies.threadId);
  for (const row of rows) byId.set(row.id, row.n);
  return byId;
}

/** A page of threads as the list shows them. */
export async function threadSummaries(db: Database, rows: ThreadRow[]) {
  const ids = rows.map((row) => row.id);
  const [reactions, counts] = await Promise.all([threadReactions(db, ids), replyCounts(db, ids)]);
  return rows.map((row) => ({
    id: row.id,
    spaceId: row.spaceId,
    kind: row.kind,
    title: row.title,
    excerpt: excerptOf(row.body),
    authorId: row.authorId,
    createdAt: row.createdAt,
    lastActivityAt: row.lastActivityAt,
    replyCount: counts.get(row.id) ?? 0,
    solved: row.solvedReplyId !== null,
    reactions: reactions.get(row.id)!,
  }));
}

/** A reply as a thread shows it: a taken down one keeps its place, not its words. */
export function replyWire(row: ReplyRow, reactions: Reactions) {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    parentId: row.parentId,
    authorId: row.authorId,
    body: deleted ? '' : row.body,
    deleted,
    depth: row.depth,
    createdAt: row.createdAt,
    reactions: deleted ? noReactions() : reactions,
  };
}

/** Total reactions per thread, for sorting by the most reacted to. */
export function reactionTotal(reactions: Reactions): number {
  return Object.values(reactions).reduce((sum, ids) => sum + ids.length, 0);
}
