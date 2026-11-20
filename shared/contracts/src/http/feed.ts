import { z } from 'zod';
import { POST_COMMENT_MAX_LENGTH, POST_MAX_LENGTH, POST_REACTIONS } from '../limits.ts';
import { uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';

/**
 * The feed (Phase 2c): the workspace's posts and the pictures from its
 * rooms, newest first, a page at a time, ending where you last caught up.
 * Inside the workspace only: a non-member gets 404, like everywhere else.
 */

const postParams = workspaceParams.extend({ postId: z.string() });
const reaction = z.enum(POST_REACTIONS);

const image = z.object({ url: z.string(), width: z.number().int(), height: z.number().int() });

/** Who reacted, by id, for each reaction: shown as faces, never as a total. */
const reactions = z.object(
  Object.fromEntries(POST_REACTIONS.map((name) => [name, z.array(uuid)])) as Record<
    (typeof POST_REACTIONS)[number],
    z.ZodArray<typeof uuid>
  >,
);

const post = z.object({
  id: uuid,
  authorId: uuid,
  kind: z.enum(['text', 'photo', 'checkin']),
  body: z.string(),
  photo: image.nullable(),
  createdAt: timestamp,
  editedAt: timestamp.nullable(),
  commentCount: z.number().int(),
  reactions,
});

/** A picture from a room, linking back to its message there. */
const picture = z.object({
  messageId: uuid,
  channelId: uuid,
  authorId: uuid,
  url: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  createdAt: timestamp,
});

const feedItem = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('post'), post }),
  z.object({ kind: z.literal('picture'), picture }),
]);

const comment = z.object({
  id: uuid,
  postId: uuid,
  authorId: uuid,
  body: z.string(),
  createdAt: timestamp,
});

const words = (max: number) => z.string().trim().min(1, 'Write something first').max(max);

export const feedContracts = {
  'feed.list': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/feed',
    summary:
      'The feed, newest first: posts and pictures from rooms, a page at a time; `seenAt` is where you last caught up.',
    params: workspaceParams,
    query: z.object({ before: z.string().max(80).optional() }),
    response: z.object({
      items: z.array(feedItem),
      seenAt: timestamp.nullable(),
      nextCursor: z.string().nullable(),
    }),
  }),
  'feed.seen': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/feed/seen',
    summary: 'Mark the feed caught up to now, for you.',
    params: workspaceParams,
    response: z.object({ seenAt: timestamp }),
  }),
  'posts.create': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/posts',
    summary: 'Post a few words to the feed.',
    params: workspaceParams,
    body: z.object({ body: words(POST_MAX_LENGTH) }),
    status: 201,
    response: z.object({ post }),
  }),
  'posts.createPhoto': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/posts/photo',
    summary:
      'Post a photo to the feed; re-encoded and stripped of metadata, within the workspace’s storage. Add words with posts.update.',
    params: workspaceParams,
    rawBody: 'image/*',
    status: 201,
    response: z.object({ post }),
  }),
  'posts.update': contract({
    method: 'PATCH',
    path: '/workspaces/:workspaceId/posts/:postId',
    summary: "Change your post's words, or a photo's caption (empty clears it).",
    params: postParams,
    body: z.object({ body: z.string().trim().max(POST_MAX_LENGTH) }),
    response: z.object({ post }),
  }),
  'posts.delete': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/posts/:postId',
    summary: 'Take down your post, or as an admin, any.',
    params: postParams,
    status: 204,
    response: null,
  }),
  'posts.comments': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/posts/:postId/comments',
    summary: "A post's comments, oldest first.",
    params: postParams,
    response: z.object({ comments: z.array(comment) }),
  }),
  'posts.comment': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/posts/:postId/comments',
    summary: 'Comment on a post.',
    params: postParams,
    body: z.object({ body: words(POST_COMMENT_MAX_LENGTH) }),
    status: 201,
    response: z.object({ comment }),
  }),
  'posts.deleteComment': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/post-comments/:commentId',
    summary: 'Take down your comment, or as an admin, any.',
    params: workspaceParams.extend({ commentId: z.string() }),
    status: 204,
    response: null,
  }),
  'posts.react': contract({
    method: 'PUT',
    path: '/workspaces/:workspaceId/posts/:postId/reactions/:reaction',
    summary: 'React to a post: celebrate, helpful or support.',
    params: postParams.extend({ reaction }),
    status: 204,
    response: null,
  }),
  'posts.unreact': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/posts/:postId/reactions/:reaction',
    summary: 'Take back a reaction.',
    params: postParams.extend({ reaction }),
    status: 204,
    response: null,
  }),
} as const;
