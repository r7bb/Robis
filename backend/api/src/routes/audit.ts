import {
  type Database,
  listAuditEvents,
  toExported,
  users,
  verifyAuditChain,
} from '@robis/database';
import { auditEventsQuerySchema } from '@robis/shared';
import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { RateLimits } from '../app.ts';
import { currentMembership, requireAuth, requireMembership } from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';
import { parse } from '../validate.ts';

/**
 * The audit trail, for administrators and for export.
 *
 * Distinct from `/activity`, which every member sees and which is a feed: this
 * is the whole trail, keyset-paged so an exporter can walk it without gaps,
 * in the same wire shape the SIEM stream sends, plus a check of the chain.
 */
export async function auditRoutes(
  app: FastifyInstance,
  opts: { db: Database; limits: RateLimits },
) {
  const { db, limits } = opts;

  app.get(
    '/workspaces/:workspaceId/audit/events',
    { preHandler: [requireAuth, requireMembership(db, 'audit:read')] },
    async (request) => {
      const { workspaceId } = currentMembership(request);
      const query = parse(auditEventsQuerySchema, request.query);

      const { rows, nextCursor } = await listAuditEvents(db, workspaceId, query);

      // Names are looked up for the page rather than joined, and only for
      // display: the exported identity is the id, which does not change when
      // someone renames themselves.
      const actorIds = [...new Set(rows.flatMap((row) => (row.actorId ? [row.actorId] : [])))];
      const names =
        actorIds.length > 0
          ? await db
              .select({ id: users.id, name: users.name })
              .from(users)
              .where(inArray(users.id, actorIds))
          : [];
      const nameById = new Map(names.map((row) => [row.id, row.name]));

      return {
        events: rows.map((row) => ({
          ...toExported(row),
          actorName: row.actorId ? (nameById.get(row.actorId) ?? null) : null,
        })),
        nextCursor,
      };
    },
  );

  app.get(
    '/workspaces/:workspaceId/audit/verify',
    {
      preHandler: [
        requireAuth,
        requireMembership(db, 'audit:read'),
        // A full walk of the chain, hashing every row: cheap for a person to
        // ask for now and then, expensive for anyone asking in a loop.
        rateLimit({ name: 'audit-verify', limit: limits.auditVerifyPerMinute, windowMs: 60_000 }),
      ],
    },
    async (request) => {
      const { workspaceId } = currentMembership(request);
      return verifyAuditChain(db, workspaceId);
    },
  );
}
