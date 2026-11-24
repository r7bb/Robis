import { z } from 'zod';
import type { Permission } from '../rbac.ts';
import { uuid } from '../schemas.ts';
import { contract, timestamp } from './contract.ts';

/**
 * Outgoing webhooks (C7). An admin chooses the events and an https
 * address; each delivery is a POST signed with HMAC-SHA256 over the
 * timestamp and the body, and carries a delivery id that stays the same
 * on every retry, so a receiver can drop duplicates by it. Payloads hold
 * ids and only what the admin who made the webhook may still read.
 */

/** The events a webhook may choose, and what the maker must be able to read for each. */
export const WEBHOOK_EVENTS = {
  'issue.created': 'issue:read',
  'issue.updated': 'issue:read',
  'issue.status_changed': 'issue:read',
  'issue.deleted': 'issue:read',
  'comment.created': 'comment:read',
  'project.created': 'project:read',
  'document.created': 'project:read',
  'meeting.created': 'meeting:read',
  'member.joined': 'member:read',
  'member.removed': 'member:read',
} as const satisfies Record<string, Permission>;

export type WebhookEvent = keyof typeof WEBHOOK_EVENTS;
export const WEBHOOK_EVENT_NAMES = Object.keys(WEBHOOK_EVENTS) as WebhookEvent[];
/** Webhooks one workspace may have. */
export const WEBHOOKS_MAX = 10;
/** Deliveries shown in a webhook's log. */
export const WEBHOOK_DELIVERIES_SHOWN = 50;
/** Attempts before a delivery is given up as failed. */
export const WEBHOOK_ATTEMPTS = 5;

const workspaceParams = z.object({ workspaceId: uuid });
const webhookParams = workspaceParams.extend({ webhookId: uuid });

const webhookUrl = z
  .string()
  .trim()
  .max(500)
  .refine((url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && (parsed.port === '' || parsed.port === '443');
    } catch {
      return false;
    }
  }, 'A webhook must be an https:// address on the default port');

const events = z
  .array(z.enum(WEBHOOK_EVENT_NAMES as [WebhookEvent, ...WebhookEvent[]]))
  .min(1, 'Choose at least one event')
  .max(WEBHOOK_EVENT_NAMES.length);

const webhook = z.object({
  id: uuid,
  url: z.string(),
  events: z.array(z.string()),
  enabled: z.boolean(),
  createdBy: uuid.nullable(),
  createdAt: timestamp,
});

const delivery = z.object({
  id: uuid,
  eventType: z.string(),
  status: z.enum(['pending', 'delivered', 'failed', 'skipped']),
  attempts: z.number().int(),
  lastStatusCode: z.number().int().nullable(),
  lastError: z.string().nullable(),
  createdAt: timestamp,
  deliveredAt: timestamp.nullable(),
});

export const webhookContracts = {
  'webhooks.list': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/webhooks',
    summary: "The workspace's outgoing webhooks, never their secrets. Admins only.",
    params: workspaceParams,
    response: z.object({ webhooks: z.array(webhook) }),
  }),
  'webhooks.create': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/webhooks',
    summary:
      'Add an outgoing webhook for chosen events; its signing secret is in this answer and never again. Admins only.',
    params: workspaceParams,
    body: z.object({ url: webhookUrl, events }),
    status: 201,
    response: z.object({ webhook, secret: z.string() }),
  }),
  'webhooks.update': contract({
    method: 'PATCH',
    path: '/workspaces/:workspaceId/webhooks/:webhookId',
    summary: 'Turn a webhook on or off, or change its events. Admins only.',
    params: webhookParams,
    body: z.object({ enabled: z.boolean().optional(), events: events.optional() }),
    response: z.object({ webhook }),
  }),
  'webhooks.delete': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/webhooks/:webhookId',
    summary: 'Remove a webhook and its delivery log. Admins only.',
    params: webhookParams,
    status: 204,
    response: null,
  }),
  'webhooks.deliveries': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/webhooks/:webhookId/deliveries',
    summary:
      "A webhook's latest deliveries, with each one's attempts and last answer. Admins only.",
    params: webhookParams,
    response: z.object({ deliveries: z.array(delivery) }),
  }),
};
