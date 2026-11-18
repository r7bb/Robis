import { type Database, searchWorkspace } from '@robis/database';
import { contracts } from '@robis/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { RateLimits } from '../app.ts';
import { serve } from '../contract.ts';
import { currentMembership, requireAuth, requireMembership } from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';

/** Long enough for any real search; a query still running then is stopped. */
const SEARCH_TIMEOUT = '3s';

/**
 * Search within one workspace.
 *
 * Scoped by the membership guard like everything else, so a query can only
 * ever reach rows the caller is already entitled to read -- the search index
 * is not a side door around authorization.
 */
export async function searchRoutes(
  app: FastifyInstance,
  opts: { db: Database; limits: RateLimits },
) {
  const { db, limits } = opts;

  serve(
    app,
    contracts['search.workspace'],
    {
      preHandler: [
        requireAuth,
        requireMembership(db, 'issue:read'),
        // Full-text queries are the most expensive read here, so they get a
        // tighter budget than ordinary endpoints.
        rateLimit({ name: 'search', limit: limits.searchPerMinute, windowMs: 60_000 }),
      ],
    },
    async (request, { query: { q, type, limit } }) => {
      const { workspaceId } = currentMembership(request);

      // Typed into on every pause (C2): a query that runs long is stopped
      // rather than left holding a connection.
      const results = await db.transaction(async (tx) => {
        await tx.execute(sql.raw(`set local statement_timeout = '${SEARCH_TIMEOUT}'`));
        return searchWorkspace(tx, workspaceId, (q ?? '').slice(0, 200), { type, limit });
      });

      return { query: q ?? '', results };
    },
  );
}
