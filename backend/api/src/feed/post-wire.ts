import { type Database, postComments, postReactions, posts } from '@robis/database';
import { isUuid, noReactions, type PostReaction } from '@robis/shared';
import { and, count, eq, inArray } from 'drizzle-orm';
import { ApiError } from '../errors.ts';

/**
 * Feed posts as the API shows them (Phase 2c): words, a photo by its
 * members-only route, how many comments, and who reacted how. Reactions and
 * comment counts for a page are read in two queries, not one per post.
 */

export type PostRow = typeof posts.$inferSelect;
type Reactions = Record<PostReaction, string[]>;

/** A post in this workspace, or 404: never another workspace's, never a 403. */
export async function postIn(db: Database, workspaceId: string, postId: string): Promise<PostRow> {
  if (!isUuid(postId)) throw ApiError.notFound('Post not found');
  const [row] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw ApiError.notFound('Post not found');
  return row;
}

/** Each post's reactions and comment count, for a page of them. */
async function extrasOf(db: Database, postIds: string[]) {
  const reactions = new Map<string, Reactions>(postIds.map((id) => [id, noReactions()]));
  const comments = new Map<string, number>();
  if (postIds.length === 0) return { reactions, comments };
  const [reacted, counted] = await Promise.all([
    db
      .select({
        postId: postReactions.postId,
        userId: postReactions.userId,
        reaction: postReactions.reaction,
      })
      .from(postReactions)
      .where(inArray(postReactions.postId, postIds))
      .orderBy(postReactions.createdAt),
    db
      .select({ postId: postComments.postId, n: count() })
      .from(postComments)
      .where(inArray(postComments.postId, postIds))
      .groupBy(postComments.postId),
  ]);
  for (const row of reacted) {
    const mine = reactions.get(row.postId)!;
    reactions.set(row.postId, { ...mine, [row.reaction]: [...mine[row.reaction], row.userId] });
  }
  for (const row of counted) comments.set(row.postId, row.n);
  return { reactions, comments };
}

function wireOf(row: PostRow, reactions: Reactions, commentCount: number) {
  return {
    id: row.id,
    authorId: row.authorId,
    kind: row.kind,
    body: row.body,
    photo:
      row.photoKey && row.photoWidth && row.photoHeight
        ? {
            url: `/workspaces/${row.workspaceId}/posts/${row.id}/photo`,
            width: row.photoWidth,
            height: row.photoHeight,
          }
        : null,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    commentCount,
    reactions,
  };
}

/** A page of posts as the API shows them, in the order given. */
export async function postsWire(db: Database, rows: PostRow[]) {
  const { reactions, comments } = await extrasOf(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) =>
    wireOf(row, reactions.get(row.id) ?? noReactions(), comments.get(row.id) ?? 0),
  );
}

export async function postWire(db: Database, row: PostRow) {
  const [wire] = await postsWire(db, [row]);
  return wire!;
}
