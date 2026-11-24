import type { Database } from '@robis/database';
import { contracts, WORKLOAD_HEAVY_MIN, WORKLOAD_HEAVY_RATIO } from '@robis/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import { todayFor } from '../feed/health.ts';
import { currentMembership, requireAuth, requireMembership } from '../plugins/authz.ts';

/** Days ahead that count as due soon. */
const DUE_SOON_DAYS = 7;

type Load = { open: number };

/** The middle of the open counts; nought with nobody. */
export function medianOpen(people: readonly Load[]): number {
  if (people.length === 0) return 0;
  const sorted = people.map((p) => p.open).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Heavy: at least `WORKLOAD_HEAVY_MIN` open and `WORKLOAD_HEAVY_RATIO` times
 * the team's median, so one person with three issues among people with
 * one is not called buried, and a team that is all busy is not either.
 */
export function isHeavy(open: number, median: number): boolean {
  return open >= WORKLOAD_HEAVY_MIN && open >= WORKLOAD_HEAVY_RATIO * Math.max(median, 1);
}

/**
 * Workload: each member's open issues here, people only, or only those in
 * a cycle running today. Everyone in the workspace is listed, those with
 * nothing open too, so the median is the team's and not only of the busy.
 */
export async function workloadRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  serve(
    app,
    contracts['insights.workload'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:read')] },
    async (request, { query }) => {
      const { workspaceId } = currentMembership(request);
      const today = todayFor(query.today, new Date());
      // Only work planned now: in a cycle that is running on the asker's today.
      const inRunningCycle =
        query.scope === 'cycles'
          ? sql`and i.cycle_id in (select c.id from cycles c
                 where c.workspace_id = m.workspace_id
                   and c.starts_on <= ${today}::date and c.ends_on >= ${today}::date)`
          : sql``;
      const rows = await db.execute<{
        user_id: string;
        name: string;
        open: number;
        in_progress: number;
        overdue: number;
        due_soon: number;
        urgent: number;
      }>(sql`
        select u.id as user_id, u.name,
               count(i.id)::int as open,
               count(i.id) filter (where i.status = 'IN_PROGRESS')::int as in_progress,
               count(i.id) filter (where i.due_on < ${today}::date)::int as overdue,
               count(i.id) filter (where i.due_on >= ${today}::date
                 and i.due_on < ${today}::date + ${DUE_SOON_DAYS}::int)::int as due_soon,
               count(i.id) filter (where i.priority = 'URGENT')::int as urgent
          from workspace_members m
          join users u on u.id = m.user_id and u.kind = 'human'
          left join issues i on i.assignee_id = u.id and i.workspace_id = m.workspace_id
               and i.status not in ('DONE', 'CANCELED')
               ${inRunningCycle}
         where m.workspace_id = ${workspaceId}
         group by u.id, u.name
         order by open desc, u.name
      `);
      const people = [...rows].map((row) => ({
        userId: row.user_id,
        name: row.name,
        open: row.open,
        inProgress: row.in_progress,
        overdue: row.overdue,
        dueSoon: row.due_soon,
        urgent: row.urgent,
      }));
      const median = medianOpen(people);
      return {
        medianOpen: median,
        people: people.map((person) => ({ ...person, heavy: isHeavy(person.open, median) })),
      };
    },
  );
}
