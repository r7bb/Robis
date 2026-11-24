import { z } from 'zod';
import {
  SPACE_DESCRIPTION_MAX_LENGTH,
  SPACE_NAME_MAX_LENGTH,
  SPACE_REPLY_MAX_LENGTH,
  SPACE_THREAD_KINDS,
  THREAD_BODY_MAX_LENGTH,
  THREAD_TITLE_MAX_LENGTH,
} from '../limits.ts';
import { uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';
import { reaction, reactions } from './feed.ts';

/**
 * Spaces: topics within the workspace, like groups on a forum. A thread
 * asks a question or shares an idea; replies nest under replies; the asker
 * marks the answer that solved it; reactions say what helped. The most
 * helpful lists count the Helpful marks people's replies received. Inside
 * the workspace only: a non-member gets 404, like everywhere else.
 */

const spaceParams = workspaceParams.extend({ spaceId: z.string() });
const threadParams = workspaceParams.extend({ threadId: z.string() });
const replyParams = workspaceParams.extend({ replyId: z.string() });

const words = (max: number) => z.string().trim().min(1).max(max);

const space = z.object({
  id: uuid,
  name: z.string(),
  description: z.string(),
  createdBy: uuid,
  createdAt: timestamp,
  threadCount: z.number().int().nonnegative(),
  /** When anything in it last happened; null for an empty space. */
  lastActivityAt: timestamp.nullable(),
  /** Whether you follow it: its new threads come to your Following feed. */
  following: z.boolean(),
});

const threadSummary = z.object({
  id: uuid,
  spaceId: uuid,
  kind: z.enum(SPACE_THREAD_KINDS),
  title: z.string(),
  /** The first few lines of the body, for the list. */
  excerpt: z.string(),
  authorId: uuid,
  createdAt: timestamp,
  lastActivityAt: timestamp,
  replyCount: z.number().int().nonnegative(),
  solved: z.boolean(),
  reactions,
});

const thread = threadSummary.omit({ excerpt: true }).extend({
  body: z.string(),
  solvedReplyId: uuid.nullable(),
  spaceName: z.string(),
});

const reply = z.object({
  id: uuid,
  parentId: uuid.nullable(),
  authorId: uuid,
  /** Empty once taken down; the replies under it keep their place. */
  body: z.string(),
  deleted: z.boolean(),
  depth: z.number().int().nonnegative(),
  createdAt: timestamp,
  reactions,
});

const LEADER_PERIODS = ['week', 'month', 'all'] as const;
const THREAD_SORTS = ['active', 'new', 'top', 'unanswered'] as const;

const leader = z.object({
  userId: uuid,
  /** Helpful marks on this person's replies, in the period. */
  helpful: z.number().int().nonnegative(),
  /** Their replies marked as the answer, in the period. */
  answers: z.number().int().nonnegative(),
});

const topReply = z.object({
  replyId: uuid,
  threadId: uuid,
  threadTitle: z.string(),
  spaceName: z.string(),
  authorId: uuid,
  excerpt: z.string(),
  helpful: z.number().int().positive(),
  answer: z.boolean(),
});

export const spaceContracts = {
  'spaces.list': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/spaces',
    summary: 'Every space in the workspace, the most recently active first.',
    params: workspaceParams,
    response: z.object({ spaces: z.array(space) }),
  }),
  'spaces.create': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/spaces',
    summary: 'Start a space: a topic for threads, named once per workspace.',
    params: workspaceParams,
    body: z.object({
      name: words(SPACE_NAME_MAX_LENGTH),
      description: z.string().trim().max(SPACE_DESCRIPTION_MAX_LENGTH).optional(),
    }),
    status: 201,
    response: z.object({ space }),
  }),
  'spaces.threads': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/spaces/:spaceId/threads',
    summary:
      'A space’s threads: most recently active, newest, most reacted to, or questions with no answer yet.',
    params: spaceParams,
    query: z.object({ sort: z.enum(THREAD_SORTS).default('active') }),
    response: z.object({ space, threads: z.array(threadSummary) }),
  }),
  'spaces.createThread': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/spaces/:spaceId/threads',
    summary: 'Start a thread in a space: a question, an idea, a discussion or a tip.',
    params: spaceParams,
    body: z.object({
      kind: z.enum(SPACE_THREAD_KINDS),
      title: words(THREAD_TITLE_MAX_LENGTH),
      body: z.string().trim().max(THREAD_BODY_MAX_LENGTH).optional(),
    }),
    status: 201,
    response: z.object({ thread }),
  }),
  'spaces.thread': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/space-threads/:threadId',
    summary: 'A thread and its replies, oldest first, each with the reply it answers.',
    params: threadParams,
    response: z.object({ thread, replies: z.array(reply), truncated: z.boolean() }),
  }),
  'spaces.deleteThread': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/space-threads/:threadId',
    summary: 'Take down a thread you started, or as an admin, any, with its replies.',
    params: threadParams,
    status: 204,
    response: null,
  }),
  'spaces.reply': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/space-threads/:threadId/replies',
    summary: 'Reply to a thread, or to a reply in it.',
    params: threadParams,
    body: z.object({ body: words(SPACE_REPLY_MAX_LENGTH), parentId: uuid.optional() }),
    status: 201,
    response: z.object({ reply }),
  }),
  'spaces.deleteReply': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/space-replies/:replyId',
    summary:
      'Take down a reply you wrote, or as an admin, any. Its words go; the replies under it stay.',
    params: replyParams,
    status: 204,
    response: null,
  }),
  'spaces.solve': contract({
    method: 'PUT',
    path: '/workspaces/:workspaceId/space-threads/:threadId/answer',
    summary:
      'Mark the reply that answered a question, or clear it: for whoever asked, or an admin.',
    params: threadParams,
    body: z.object({ replyId: uuid.nullable() }),
    response: z.object({ solvedReplyId: uuid.nullable() }),
  }),
  'spaces.react': contract({
    method: 'PUT',
    path: '/workspaces/:workspaceId/space-reactions/:targetId/:reaction',
    summary: 'React to a thread or a reply in a space.',
    params: workspaceParams.extend({ targetId: z.string(), reaction }),
    status: 204,
    response: null,
  }),
  'spaces.unreact': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/space-reactions/:targetId/:reaction',
    summary: 'Take back a reaction in a space.',
    params: workspaceParams.extend({ targetId: z.string(), reaction }),
    status: 204,
    response: null,
  }),
  'spaces.follow': contract({
    method: 'PUT',
    path: '/workspaces/:workspaceId/spaces/:spaceId/follow',
    summary: 'Follow a space, so its new threads come to your Following feed.',
    params: spaceParams,
    status: 204,
    response: null,
  }),
  'spaces.unfollow': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/spaces/:spaceId/follow',
    summary: 'Stop following a space.',
    params: spaceParams,
    status: 204,
    response: null,
  }),
  'spaces.leaders': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/spaces-leaders',
    summary:
      'The most helpful people and replies across every space: Helpful marks received and answers given, this week, this month or of all time.',
    params: workspaceParams,
    query: z.object({ period: z.enum(LEADER_PERIODS).default('month') }),
    response: z.object({ people: z.array(leader), replies: z.array(topReply) }),
  }),
  'spaces.similar': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/space-threads/similar',
    summary:
      'Threads in any space here sharing words with a draft title, answered ones first: asked before? At most five.',
    params: workspaceParams,
    query: z.object({ q: z.string().max(200).default('') }),
    response: z.object({
      threads: z.array(
        z.object({
          id: uuid,
          title: z.string(),
          spaceName: z.string(),
          solved: z.boolean(),
          replyCount: z.number().int().nonnegative(),
        }),
      ),
    }),
  }),
} as const;
