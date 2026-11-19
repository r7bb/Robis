import { z } from 'zod';
import { USER_KINDS } from '../domain.ts';
import { uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';

/**
 * Issues and chat, joined by the issue's key (C, "discuss"): where an issue
 * is talked about, and the issue a key typed in chat names. Both only read.
 */

/** How much of a message the issue shows; the room has the rest. */
export const DISCUSSION_PREVIEW_CHARS = 280;
/** The newest this many messages naming the issue. */
export const DISCUSSION_LIMIT = 10;

export const discussionContracts = {
  'issues.discussion': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/issues/:issueId/discussion',
    summary: 'The newest chat messages that name this issue by its key, with their rooms.',
    params: workspaceParams.extend({ issueId: z.string() }),
    response: z.object({
      messages: z.array(
        z.object({
          id: uuid,
          channelId: uuid,
          channelName: z.string(),
          authorId: uuid,
          authorName: z.string(),
          authorKind: z.enum(USER_KINDS),
          /** The start of the message, at most DISCUSSION_PREVIEW_CHARS. */
          body: z.string(),
          createdAt: timestamp,
        }),
      ),
    }),
  }),
  'issues.byKey': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/issue-keys/:key',
    summary: 'The issue a key such as REL-4 names in this workspace, in any case.',
    params: workspaceParams.extend({ key: z.string() }),
    response: z.object({
      issue: z.object({ id: uuid, projectId: uuid, key: z.string(), title: z.string() }),
    }),
  }),
} as const;
