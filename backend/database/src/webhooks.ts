import { WEBHOOK_EVENTS } from '@robis/shared';
import { and, arrayContains, eq } from 'drizzle-orm';
import type { Executor } from './index.ts';
import { enqueue } from './queue.ts';
import { webhookDeliveries, workspaceWebhooks } from './schema.ts';

/**
 * Workspace webhooks (C7): every audited event a webhook listens for gets a
 * delivery row, queued for the worker in the same transaction as the event,
 * so a rolled-back change sends nothing and a committed one cannot be
 * forgotten. The row's id is the idempotency key the receiver sees.
 */

export const WORKSPACE_WEBHOOK_JOB = 'webhook.deliver';
export type WorkspaceWebhookJob = { deliveryId: string };

export async function queueWebhooks(
  tx: Executor,
  event: {
    id: string;
    workspaceId: string;
    eventType: string;
    entityType: string;
    entityId: string;
    actorId: string | null;
    actorKind: string;
    createdAt: Date;
  },
): Promise<void> {
  if (!(event.eventType in WEBHOOK_EVENTS)) return;
  const listening = await tx
    .select({ id: workspaceWebhooks.id })
    .from(workspaceWebhooks)
    .where(
      and(
        eq(workspaceWebhooks.workspaceId, event.workspaceId),
        eq(workspaceWebhooks.enabled, true),
        arrayContains(workspaceWebhooks.events, [event.eventType]),
      ),
    );
  for (const webhook of listening) {
    const [delivery] = await tx
      .insert(webhookDeliveries)
      .values({
        webhookId: webhook.id,
        workspaceId: event.workspaceId,
        eventId: event.id,
        eventType: event.eventType,
        entityType: event.entityType,
        entityId: event.entityId,
        actorId: event.actorId,
        actorKind: event.actorKind,
        occurredAt: event.createdAt,
      })
      .onConflictDoNothing()
      .returning({ id: webhookDeliveries.id });
    if (delivery) await enqueue(tx, WORKSPACE_WEBHOOK_JOB, { deliveryId: delivery.id });
  }
}
