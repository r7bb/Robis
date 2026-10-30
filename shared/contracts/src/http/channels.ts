import { z } from 'zod';
import {
  createChannelSchema,
  createMessageSchema,
  listMessagesQuerySchema,
  updateChannelSchema,
  uuid,
} from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';

/** Ids stay plain strings: one that is not a channel is a 404, not a 400. */
const channelParams = workspaceParams.extend({ channelId: z.string() });

const channel = z.object({
  id: uuid,
  name: z.string(),
  topic: z.string().nullable(),
  createdAt: timestamp,
});

/** A message as the API shows it; never its search vector. */
const message = z.object({
  id: uuid,
  channelId: uuid,
  body: z.string(),
  createdAt: timestamp,
  editedAt: timestamp.nullable(),
  authorId: uuid,
  authorName: z.string(),
});

export const channelContracts = {
  'channels.list': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/channels',
    summary: "A workspace's channels, by name.",
    params: workspaceParams,
    response: z.object({ channels: z.array(channel) }),
  }),
  'channels.create': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/channels',
    summary: 'Open a channel; its name is normalised, and must be free.',
    params: workspaceParams,
    body: createChannelSchema,
    status: 201,
    response: z.object({ channel }),
  }),
  'channels.update': contract({
    method: 'PATCH',
    path: '/workspaces/:workspaceId/channels/:channelId',
    summary: 'Rename a channel or change its topic.',
    params: channelParams,
    body: updateChannelSchema,
    response: z.object({ channel }),
  }),
  'channels.delete': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/channels/:channelId',
    summary: 'Delete a channel and its messages.',
    params: channelParams,
    status: 204,
    response: null,
  }),
  'messages.list': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/channels/:channelId/messages',
    summary: "A page of a channel's messages, newest first, with a cursor for the next.",
    params: channelParams,
    query: listMessagesQuerySchema,
    response: z.object({ messages: z.array(message), nextCursor: z.string().nullable() }),
  }),
  'messages.create': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/channels/:channelId/messages',
    summary: 'Post a message to a channel.',
    params: channelParams,
    body: createMessageSchema,
    status: 201,
    response: z.object({ message }),
  }),
  'messages.delete': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/messages/:messageId',
    summary: "Delete your own message, or as an admin, anyone's.",
    params: workspaceParams.extend({ messageId: z.string() }),
    status: 204,
    response: null,
  }),
} as const;
