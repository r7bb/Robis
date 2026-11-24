import { cycles, type Database, issues, projects } from '@robis/database';
import { contracts } from '@robis/shared';
import { and, asc, eq, gte, inArray, lte, notInArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import { currentMembership, requireAuth, requireMembership } from '../plugins/authz.ts';
import { CYCLE_COUNTS, FINISHED } from './cycle-counts.ts';

/** How many of a cycle's unfinished issues an answer names. */
const OPEN_LISTED = 5;

/** Work under way comes first in what is left, then work not started. */
const UNDER_WAY_FIRST = sql`case ${issues.status} when 'IN_REVIEW' then 0 when 'IN_PROGRESS' then 1 else 2 end`;

/**
 * The cycles running today on each of the workspace's boards that are not
 * archived, with how their issues stand and the first few still open. For
 * Sapha's "how is the cycle going", asked from anywhere in the workspace.
 * Today is the asker's own calendar day, as the board reckons it.
 */
export async function currentCycleRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  serve(
    app,
    contracts['cycles.current'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:read')] },
    async (request, { query }) => {
      const { workspaceId } = currentMembership(request);
      const today = query.today ?? new Date().toISOString().slice(0, 10);
      const running = await db
        .select({
          ...CYCLE_COUNTS,
          projectName: projects.name,
          projectKey: projects.key,
        })
        .from(cycles)
        .innerJoin(projects, eq(projects.id, cycles.projectId))
        .leftJoin(issues, eq(issues.cycleId, cycles.id))
        .where(
          and(
            eq(cycles.workspaceId, workspaceId),
            eq(projects.archived, false),
            lte(cycles.startsOn, today),
            gte(cycles.endsOn, today),
          ),
        )
        .groupBy(cycles.id, projects.id)
        .orderBy(asc(projects.name), asc(cycles.startsOn));
      if (running.length === 0) return { cycles: [] };

      const open = await db
        .select({
          id: issues.id,
          cycleId: issues.cycleId,
          number: issues.number,
          title: issues.title,
          status: issues.status,
        })
        .from(issues)
        .where(
          and(
            eq(issues.workspaceId, workspaceId),
            inArray(
              issues.cycleId,
              running.map((c) => c.id),
            ),
            notInArray(issues.status, [...FINISHED]),
          ),
        )
        .orderBy(UNDER_WAY_FIRST, asc(issues.number));

      return {
        cycles: running.map((cycle) => ({
          ...cycle,
          open: open
            .filter((issue) => issue.cycleId === cycle.id)
            .slice(0, OPEN_LISTED)
            .map((issue) => ({
              id: issue.id,
              key: `${cycle.projectKey}-${issue.number}`,
              title: issue.title,
              status: issue.status,
            })),
        })),
      };
    },
  );
}
