import { type Database, issues, projects } from '@robis/database';
import { contracts } from '@robis/shared';
import { and, asc, desc, eq, notInArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import {
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';

/** Done or called off: nothing to do today. */
const CLOSED = ['DONE', 'CANCELED'] as const;
/** More than a day can hold; the page shows the first of each group. */
const LISTED = 100;

/**
 * Today: your open issues here, soonest due first (no due day last), then
 * by priority, for the page to group. Only yours, only in this workspace.
 */
export async function todayRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  serve(
    app,
    contracts['today.mine'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:read')] },
    async (request) => {
      const { workspaceId } = currentMembership(request);
      const user = currentUser(request);
      const rows = await db
        .select({
          id: issues.id,
          key: sql<string>`${projects.key} || '-' || ${issues.number}`,
          title: issues.title,
          status: issues.status,
          priority: issues.priority,
          dueOn: issues.dueOn,
          projectId: issues.projectId,
          projectName: projects.name,
        })
        .from(issues)
        .innerJoin(projects, eq(projects.id, issues.projectId))
        .where(
          and(
            eq(issues.workspaceId, workspaceId),
            eq(issues.assigneeId, user.id),
            notInArray(issues.status, [...CLOSED]),
            eq(projects.archived, false),
          ),
        )
        .orderBy(
          sql`${issues.dueOn} asc nulls last`,
          desc(
            sql`array_position(array['NONE','LOW','MEDIUM','HIGH','URGENT'], ${issues.priority}::text)`,
          ),
          asc(issues.number),
        )
        .limit(LISTED);
      return { issues: rows };
    },
  );
}
