import { z } from 'zod';
import { MESSAGE_REACTIONS } from '../limits.ts';
import { workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';

/**
 * Chat that keeps your place: how many messages wait in each room since you
 * last read it, marking a room read, and quick reactions on a message.
 */

/** Past this, a room shows "99+": the exact count is not the point. */
export const UNREAD_SHOWN_MAX = 99;

const reactionParams = workspaceParams.extend({
  messageId: z.string(),
  reaction: z.enum(MESSAGE_REACTIONS),
});

const reactions = z.object({
  reactions: z.array(
    z.object({
      reaction: z.enum(MESSAGE_REACTIONS),
      count: z.number().int().positive(),
      mine: z.boolean(),
    }),
  ),
});

export const chatReadContracts = {
  'channels.unread': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/channel-reads',
    summary:
      'For each room, how many messages by others came after you last read it (at most 99), and when that was.',
    params: workspaceParams,
    response: z.object({
      rooms: z.array(
        z.object({
          channelId: z.string(),
          unread: z.number().int().nonnegative(),
          lastReadAt: timestamp.nullable(),
        }),
      ),
    }),
  }),
  'channels.markRead': contract({
    method: 'PUT',
    path: '/workspaces/:workspaceId/channels/:channelId/read',
    summary: 'Mark a room read up to its newest message.',
    params: workspaceParams.extend({ channelId: z.string() }),
    response: z.object({ lastReadAt: timestamp }),
  }),
  'messages.react': contract({
    method: 'PUT',
    path: '/workspaces/:workspaceId/messages/:messageId/reactions/:reaction',
    summary: 'Add your reaction to a chat message; adding it twice is one.',
    params: reactionParams,
    response: reactions,
  }),
  'messages.unreact': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/messages/:messageId/reactions/:reaction',
    summary: 'Take your reaction off a chat message.',
    params: reactionParams,
    response: reactions,
  }),
} as const;
