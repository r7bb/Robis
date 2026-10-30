import { z } from 'zod';
import { uuid } from '../schemas.ts';
import { contract, timestamp } from './contract.ts';

/** The id stays a plain string: one that is not yours is a 404, not a 400. */
const notificationParams = z.object({ notificationId: z.string() });

/**
 * What a notification says, by kind. The fields each kind uses are named;
 * anything else it carries passes through, so a new kind needs no change here.
 */
const payload = z.looseObject({
  /** Mentions. */
  issueId: z.string().optional(),
  issueKey: z.string().nullable().optional(),
  issueTitle: z.string().nullable().optional(),
  excerpt: z.string().optional(),
  /** Invitations. */
  workspaceName: z.string().nullable().optional(),
  role: z.string().optional(),
  /** Nudges. */
  title: z.string().optional(),
  body: z.string().optional(),
  nudge: z.string().optional(),
});

const notification = z.object({
  id: uuid,
  kind: z.string(),
  workspaceId: uuid.nullable(),
  entityType: z.string(),
  /** Null for a notification about no one thing (a nudge, say). */
  entityId: z.string().nullable(),
  payload,
  readAt: timestamp.nullable(),
  createdAt: timestamp,
  actorId: uuid.nullable(),
  actorName: z.string().nullable(),
});

export const notificationContracts = {
  'notifications.list': contract({
    method: 'GET',
    path: '/notifications',
    summary: 'Your last 100 notifications, newest first, with how many are unread.',
    // `1` or `true` for unread only.
    query: z.object({ unread: z.string().optional() }),
    response: z.object({ notifications: z.array(notification), unreadCount: z.number().int() }),
  }),
  'notifications.read': contract({
    method: 'POST',
    path: '/notifications/:notificationId/read',
    summary: 'Mark one notification read.',
    params: notificationParams,
    response: z.object({ notification: z.object({ id: uuid, readAt: timestamp.nullable() }) }),
  }),
  'notifications.delete': contract({
    method: 'DELETE',
    path: '/notifications/:notificationId',
    summary: 'Dismiss a notification.',
    params: notificationParams,
    status: 204,
    response: null,
  }),
  'notifications.readAll': contract({
    method: 'POST',
    path: '/notifications/read-all',
    summary: 'Mark every notification read.',
    response: z.object({ marked: z.number().int() }),
  }),
} as const;
