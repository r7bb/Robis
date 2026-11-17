import { type Database, suggestionFeedback } from '@robis/database';
import { contracts, OFFLINE_DUPLICATE_EVALUATION } from '@robis/shared';
import { count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import {
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';
import { withIdempotency } from '../plugins/idempotency.ts';
import { rateLimit } from '../plugins/rate-limit.ts';

/**
 * What people do with the composer's hints (B6).
 *
 * A deliberate exception to "every mutating route writes to the audit
 * trail": a click on a hint changes nothing in the workspace, it measures
 * the hints, and recording each one there would bury the changes the trail
 * exists for. For the same reason nobody is named in the row. It does go
 * through the idempotency ledger, and it is rate-limited per person, so one
 * client cannot skew a workspace's figures.
 */

/** Plenty for a person typing issues, too few to flood the figures. */
const FEEDBACK_PER_MINUTE = 60;

export async function feedbackRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;
  const perPerson = rateLimit({
    name: 'suggestion-feedback',
    limit: FEEDBACK_PER_MINUTE,
    windowMs: 60_000,
    key: (request) => request.user?.id ?? null,
  });

  serve(
    app,
    contracts['suggestions.feedback'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:read'), perPerson] },
    async (request, { body }, reply) => {
      const { workspaceId } = currentMembership(request);
      // The figures measure how people take the hints; an agent's opinion is not one.
      if (currentUser(request).kind === 'agent') {
        throw new ApiError(403, 'people_only', 'Hint feedback is for people, not agents');
      }
      return withIdempotency(db, request, reply, 204, async () => {
        await db.insert(suggestionFeedback).values({
          workspaceId,
          kind: body.kind,
          action: body.action,
          score: body.score ?? null,
        });
        return undefined;
      });
    },
  );

  serve(
    app,
    contracts['suggestions.stats'],
    { preHandler: [requireAuth, requireMembership(db, 'agent:manage')] },
    async (request) => {
      const { workspaceId } = currentMembership(request);
      const rows = await db
        .select({ kind: suggestionFeedback.kind, action: suggestionFeedback.action, n: count() })
        .from(suggestionFeedback)
        .where(eq(suggestionFeedback.workspaceId, workspaceId))
        .groupBy(suggestionFeedback.kind, suggestionFeedback.action);
      const of = (kind: 'duplicate' | 'priority', action: 'accepted' | 'dismissed') =>
        rows.find((row) => row.kind === kind && row.action === action)?.n ?? 0;

      return {
        live: {
          duplicate: {
            accepted: of('duplicate', 'accepted'),
            dismissed: of('duplicate', 'dismissed'),
          },
          priority: {
            accepted: of('priority', 'accepted'),
            dismissed: of('priority', 'dismissed'),
          },
        },
        offline: { duplicate: { ...OFFLINE_DUPLICATE_EVALUATION }, priority: null },
      };
    },
  );
}
