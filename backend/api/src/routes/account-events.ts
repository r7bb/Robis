import { type Database, listAccountEvents, verifyAccountChain } from '@robis/database';
import { contracts } from '@robis/shared';
import type { FastifyInstance } from 'fastify';
import type { RateLimits } from '../app.ts';
import { serve } from '../contract.ts';
import { currentUser, requireAuth } from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';

/**
 * An account's own trail, for the account holder alone: there is no route
 * by which anyone else, a workspace owner included, can read it.
 */
export async function accountEventRoutes(
  app: FastifyInstance,
  opts: { db: Database; limits: RateLimits },
) {
  const { db, limits } = opts;

  serve(app, contracts['auth.events'], { preHandler: requireAuth }, async (request, { query }) => {
    const user = currentUser(request);
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

  serve(
    app,
    contracts['auth.verifyEvents'],
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
