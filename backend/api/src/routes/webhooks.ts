import { generateSessionToken } from '@robis/auth';
import { type Database, recordAudit, webhookDeliveries, workspaceWebhooks } from '@robis/database';
import { contracts, WEBHOOK_DELIVERIES_SHOWN, WEBHOOKS_MAX } from '@robis/shared';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import {
  auditActor,
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';

/**
 * Outgoing webhooks (C7), for admins: add one for chosen events, turn it
 * off or change its events, remove it, and read its delivery log. The
 * secret is made here and shown once; the address is checked as https
 * here and again, with its resolved addresses, before every send. Each
 * change is in the audit trail, without the secret.
 */

const wire = (row: typeof workspaceWebhooks.$inferSelect) => ({
  id: row.id,
  url: row.url,
  events: row.events,
  enabled: row.enabled,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
});

export async function webhookRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;
  const admin = [requireAuth, requireMembership(db, 'webhook:manage')];

  async function webhookIn(workspaceId: string, webhookId: string) {
    const [row] = await db
      .select()
      .from(workspaceWebhooks)
      .where(
        and(eq(workspaceWebhooks.id, webhookId), eq(workspaceWebhooks.workspaceId, workspaceId)),
      );
    if (!row) throw ApiError.notFound('Webhook not found');
    return row;
  }

  serve(app, contracts['webhooks.list'], { preHandler: admin }, async (request) => {
    const { workspaceId } = currentMembership(request);
    const rows = await db
      .select()
      .from(workspaceWebhooks)
      .where(eq(workspaceWebhooks.workspaceId, workspaceId))
      .orderBy(workspaceWebhooks.createdAt);
    return { webhooks: rows.map(wire) };
  });

  serve(app, contracts['webhooks.create'], { preHandler: admin }, async (request, { body }) => {
    const { workspaceId } = currentMembership(request);
    const user = currentUser(request);
    const secret = generateSessionToken();
    const created = await db.transaction(async (tx) => {
      // One at a time per workspace, so two adds cannot both pass the cap.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`webhooks:${workspaceId}`}))`);
      const [{ n } = { n: 0 }] = await tx
        .select({ n: count() })
        .from(workspaceWebhooks)
        .where(eq(workspaceWebhooks.workspaceId, workspaceId));
      if (n >= WEBHOOKS_MAX) {
        throw ApiError.conflict(
          `A workspace has at most ${WEBHOOKS_MAX} webhooks.`,
          'webhooks_max',
        );
      }
      const [row] = await tx
        .insert(workspaceWebhooks)
        .values({
          workspaceId,
          url: body.url,
          events: [...new Set(body.events)],
          secret,
          createdBy: user.id,
        })
        .returning();
      await recordAudit(tx, auditActor(request), {
        workspaceId,
        entityType: 'webhook',
        entityId: row!.id,
        eventType: 'webhook.created',
        payload: { host: new URL(row!.url).host, events: row!.events },
      });
      return row!;
    });
    return { webhook: wire(created), secret };
  });

  serve(
    app,
    contracts['webhooks.update'],
    { preHandler: admin },
    async (request, { params, body }) => {
      const { workspaceId } = currentMembership(request);
      await webhookIn(workspaceId, params.webhookId);
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(workspaceWebhooks)
          .set({
            ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
            ...(body.events ? { events: [...new Set(body.events)] } : {}),
          })
          .where(eq(workspaceWebhooks.id, params.webhookId))
          .returning();
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'webhook',
          entityId: params.webhookId,
          eventType: 'webhook.updated',
          payload: { enabled: row!.enabled, events: row!.events },
        });
        return row!;
      });
      return { webhook: wire(updated) };
    },
  );

  serve(
    app,
    contracts['webhooks.delete'],
    { preHandler: admin },
    async (request, { params }, reply) => {
      const { workspaceId } = currentMembership(request);
      const row = await webhookIn(workspaceId, params.webhookId);
      await db.transaction(async (tx) => {
        await tx.delete(workspaceWebhooks).where(eq(workspaceWebhooks.id, row.id));
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'webhook',
          entityId: row.id,
          eventType: 'webhook.deleted',
          payload: { host: new URL(row.url).host },
        });
      });
      return reply.code(204).send();
    },
  );

  serve(
    app,
    contracts['webhooks.deliveries'],
    { preHandler: admin },
    async (request, { params }) => {
      const { workspaceId } = currentMembership(request);
      await webhookIn(workspaceId, params.webhookId);
      const rows = await db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.webhookId, params.webhookId))
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(WEBHOOK_DELIVERIES_SHOWN);
      return {
        deliveries: rows.map((d) => ({
          id: d.id,
          eventType: d.eventType,
          status: d.status as 'pending' | 'delivered' | 'failed' | 'skipped',
          attempts: d.attempts,
          lastStatusCode: d.lastStatusCode,
          lastError: d.lastError,
          createdAt: d.createdAt,
          deliveredAt: d.deliveredAt,
        })),
      };
    },
  );
}
