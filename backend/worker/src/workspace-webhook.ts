import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  comments,
  type Database,
  enqueue,
  issues,
  projects,
  WORKSPACE_WEBHOOK_JOB,
  type WorkspaceWebhookJob,
  webhookDeliveries,
  workspaceMembers,
  workspaceWebhooks,
} from '@robis/database';
import { can, WEBHOOK_ATTEMPTS, WEBHOOK_EVENTS, type WebhookEvent } from '@robis/shared';
import { and, eq } from 'drizzle-orm';
import type { JobHandler } from './runner.ts';
import { refusalFor } from './webhook.ts';

/**
 * A workspace webhook's delivery (C7). Checked again at every attempt: the
 * webhook still on, the admin who made it still able to read the event,
 * the address still https and public. The body holds ids, and an issue's
 * key, status and project, which anyone who can read the issue can read.
 * It is signed with HMAC-SHA256 over "<timestamp>.<body>", and carries the
 * delivery id, the same on every retry, for the receiver to drop repeats.
 * A failed try is retried after a minute, five, thirty and a hundred and
 * twenty; after WEBHOOK_ATTEMPTS tries the delivery is logged as failed.
 */

const TIMEOUT_MS = 5_000;
const ERROR_MAX = 300;

export const signDelivery = (secret: string, timestamp: string, body: string) =>
  `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

type Delivery = typeof webhookDeliveries.$inferSelect;

/** Record an outcome, unless another run has settled the delivery meanwhile. */
async function settle(db: Database, id: string, fields: Partial<Delivery>) {
  await db
    .update(webhookDeliveries)
    .set(fields)
    .where(and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.status, 'pending')));
}

/**
 * When to try again after each failed attempt: a minute, five, half an
 * hour, two hours. A receiver down for an afternoon still gets the event.
 */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

/** The issue an event is about, directly or through a comment on it; none once deleted. */
async function issueIdOf(db: Database, delivery: Delivery): Promise<string | null> {
  if (delivery.eventType === 'issue.deleted') return null;
  if (delivery.entityType === 'issue') return delivery.entityId;
  if (delivery.entityType !== 'comment') return null;
  const [comment] = await db
    .select({ issueId: comments.issueId })
    .from(comments)
    .where(and(eq(comments.id, delivery.entityId), eq(comments.workspaceId, delivery.workspaceId)));
  return comment?.issueId ?? null;
}

/** An issue's key, status and project, which anyone who can read the issue can read. */
async function issueOf(db: Database, delivery: Delivery) {
  const id = await issueIdOf(db, delivery);
  if (!id) return null;
  const [row] = await db
    .select({
      id: issues.id,
      number: issues.number,
      status: issues.status,
      projectId: issues.projectId,
      projectKey: projects.key,
    })
    .from(issues)
    .innerJoin(projects, eq(projects.id, issues.projectId))
    .where(and(eq(issues.id, id), eq(issues.workspaceId, delivery.workspaceId)));
  return row
    ? {
        id: row.id,
        key: `${row.projectKey}-${row.number}`,
        status: row.status,
        projectId: row.projectId,
      }
    : null;
}

type Webhook = typeof workspaceWebhooks.$inferSelect;
type Options = {
  refuse?: (url: string) => Promise<string | null>;
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
};

/** Why this delivery must not be sent now, or null: off, or its maker can no longer read it. */
async function skipReason(db: Database, delivery: Delivery, webhook: Webhook) {
  if (!webhook.enabled) return 'The webhook is turned off';
  const [maker] = webhook.createdBy
    ? await db
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, delivery.workspaceId),
            eq(workspaceMembers.userId, webhook.createdBy),
          ),
        )
    : [];
  const needs = WEBHOOK_EVENTS[delivery.eventType as WebhookEvent];
  return maker && needs && can(maker.role, needs)
    ? null
    : 'Whoever made the webhook can no longer read this';
}

/** One attempt: the answer's status, and what went wrong if anything did. */
async function attempt(
  options: Required<Options>,
  webhook: Webhook,
  delivery: Delivery,
  body: string,
): Promise<{ status: number | null; failure: string | null }> {
  try {
    const refused = await options.refuse(webhook.url);
    if (refused) return { status: null, failure: `Not sent: ${refused}` };
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await options.fetcher(webhook.url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Robis-Webhook/1',
        'x-robis-delivery': delivery.id,
        'x-robis-event': delivery.eventType,
        'x-robis-timestamp': timestamp,
        'x-robis-signature': signDelivery(webhook.secret, timestamp, body),
      },
      body,
    });
    await response.body?.cancel();
    return {
      status: response.status,
      failure: response.ok ? null : `Answered ${response.status}`,
    };
  } catch (error) {
    return {
      status: null,
      failure: error instanceof Error ? error.message.slice(0, ERROR_MAX) : 'Could not connect',
    };
  }
}

export function workspaceWebhookHandler(options: Options = {}): JobHandler {
  const resolved = { refuse: options.refuse ?? refusalFor, fetcher: options.fetcher ?? fetch };
  return async (payload, { db }) => {
    const { deliveryId } = payload as WorkspaceWebhookJob;
    if (typeof deliveryId !== 'string') throw new Error('webhook.deliver: deliveryId is required');
    const [row] = await db
      .select({ delivery: webhookDeliveries, webhook: workspaceWebhooks })
      .from(webhookDeliveries)
      .innerJoin(workspaceWebhooks, eq(workspaceWebhooks.id, webhookDeliveries.webhookId))
      .where(eq(webhookDeliveries.id, deliveryId));
    if (row?.delivery.status !== 'pending') return;
    const { delivery, webhook } = row;
    const skip = await skipReason(db, delivery, webhook);
    if (skip) {
      await settle(db, delivery.id, { status: 'skipped', lastError: skip });
      return;
    }

    const body = JSON.stringify({
      id: delivery.id,
      event: delivery.eventType,
      workspaceId: delivery.workspaceId,
      occurredAt: delivery.occurredAt.toISOString(),
      actor: { id: delivery.actorId, kind: delivery.actorKind },
      entity: { type: delivery.entityType, id: delivery.entityId },
      issue: await issueOf(db, delivery),
    });
    // Claim this attempt: if another run has taken it, or settled the
    // delivery, this one stops here rather than sending twice.
    const [claimed] = await db
      .update(webhookDeliveries)
      .set({ attempts: delivery.attempts + 1 })
      .where(
        and(
          eq(webhookDeliveries.id, delivery.id),
          eq(webhookDeliveries.status, 'pending'),
          eq(webhookDeliveries.attempts, delivery.attempts),
        ),
      )
      .returning({ attempts: webhookDeliveries.attempts });
    if (!claimed) return;
    const { status, failure } = await attempt(resolved, webhook, delivery, body);
    if (!failure) {
      await settle(db, delivery.id, {
        status: 'delivered',
        lastStatusCode: status,
        lastError: null,
        deliveredAt: new Date(),
      });
      return;
    }
    const givenUp = claimed.attempts >= WEBHOOK_ATTEMPTS;
    await settle(db, delivery.id, {
      status: givenUp ? 'failed' : 'pending',
      lastStatusCode: status,
      lastError: failure,
    });
    // The next try is a job of its own, on the delivery's schedule, so the
    // delivery row alone counts attempts.
    if (!givenUp) {
      await enqueue(
        db,
        WORKSPACE_WEBHOOK_JOB,
        { deliveryId: delivery.id },
        { delayMs: RETRY_DELAYS_MS[claimed.attempts - 1] ?? RETRY_DELAYS_MS.at(-1)! },
      );
    }
  };
}

/**
 * What a receiver should do with a delivery, as a reference and for the
 * tests: check the signature over the timestamp and body in constant time,
 * refuse a timestamp more than five minutes off, and drop a delivery id it
 * has seen before, since a retry repeats it. The set here lives in memory
 * and grows; a real receiver keeps the ids in its own store, for as long as
 * retries can come (about three hours).
 */
export function receive(
  secret: string,
  headers: Headers,
  body: string,
  seen: Set<string>,
  now = Date.now(),
): 'accepted' | 'duplicate' | 'bad signature' | 'stale' {
  const timestamp = headers.get('x-robis-timestamp') ?? '';
  const given = Buffer.from(headers.get('x-robis-signature') ?? '');
  const expected = Buffer.from(signDelivery(secret, timestamp, body));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return 'bad signature';
  }
  const signedAt = Number(timestamp);
  if (!Number.isFinite(signedAt) || Math.abs(now / 1000 - signedAt) > 300) return 'stale';
  const id = headers.get('x-robis-delivery') ?? '';
  if (seen.has(id)) return 'duplicate';
  seen.add(id);
  return 'accepted';
}

export const workspaceWebhookHandlers = { [WORKSPACE_WEBHOOK_JOB]: workspaceWebhookHandler() };
