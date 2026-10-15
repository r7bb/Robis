import { type Database, listAccountEvents, verifyAccountChain } from '@robis/database';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RateLimits } from '../app.ts';
import { currentUser, requireAuth } from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';
import { parse } from '../validate.ts';

const pageSchema = z.object({
  before: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/**
 * An account's own trail, for the account holder alone: there is no route
 * by which anyone else, a workspace owner included, can read it.
 */
export async function accountEventRoutes(
  app: FastifyInstance,
  opts: { db: Database; limits: RateLimits },
) {
  const { db, limits } = opts;

  app.get('/auth/me/events', { preHandler: requireAuth }, async (request) => {
    const user = currentUser(request);
    const query = parse(pageSchema, request.query);
    const { rows, nextCursor } = await listAccountEvents(db, user.id, query);

    return {
      events: rows.map((row) => ({
        seq: row.seq,
        type: row.eventType,
        payload: JSON.parse(row.payload) as Record<string, unknown>,
        occurredAt: row.createdAt.toISOString(),
      })),
      nextCursor,
    };
  });

  app.post(
    '/auth/me/events/verify',
    {
      preHandler: [
        requireAuth,
        rateLimit({
          name: 'account-trail-verify',
          limit: limits.auditVerifyPerMinute,
          windowMs: 60_000,
        }),
      ],
    },
    async (request) => verifyAccountChain(db, currentUser(request).id),
  );
}
