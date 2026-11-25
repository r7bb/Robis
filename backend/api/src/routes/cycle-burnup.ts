import { cycles, type Database, issues } from '@robis/database';
import { burnUp, contracts, isTimeZone, isUuid, wallOf } from '@robis/shared';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import { currentMembership, requireAuth, requireMembership } from '../plugins/authz.ts';

const pad = (n: number) => String(n).padStart(2, '0');

/** The calendar day it is now in `zone`: "2026-11-24". */
function todayIn(zone: string): string {
  const wall = wallOf(new Date(), zone);
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`;
}

/**
 * A cycle's burn-up: its issues done by the end of each day so far, each
 * counted on the day it was last moved to done, in the asker's zone, out of
 * the issues planned (canceled ones left out). Read by anyone who can read
 * the board.
 */
export async function cycleBurnUpRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  serve(
    app,
    contracts['cycles.burnup'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:read')] },
    async (request, { params: { cycleId }, query }) => {
      const { workspaceId } = currentMembership(request);
      const zone = query.timeZone ?? 'UTC';
      if (!isTimeZone(zone)) throw ApiError.badRequest('Unknown time zone', 'bad_zone');
      if (!isUuid(cycleId)) throw ApiError.notFound('Cycle not found');
      const [cycle] = await db
        .select({ startsOn: cycles.startsOn, endsOn: cycles.endsOn })
        .from(cycles)
        .where(and(eq(cycles.id, cycleId), eq(cycles.workspaceId, workspaceId)));
      if (!cycle) throw ApiError.notFound('Cycle not found');
      const [{ planned } = { planned: 0 }] = await db
        .select({ planned: sql<number>`count(*)::int` })
        .from(issues)
        .where(
          and(
            eq(issues.workspaceId, workspaceId),
            eq(issues.cycleId, cycleId),
            ne(issues.status, 'CANCELED'),
          ),
        );

      const localDay = sql<string>`to_char(${issues.completedAt} at time zone ${zone}::text, 'YYYY-MM-DD')`;
      const finished = await db
        .select({ day: localDay, count: sql<number>`count(*)::int` })
        .from(issues)
        .where(
          and(
            eq(issues.workspaceId, workspaceId),
            eq(issues.cycleId, cycleId),
            eq(issues.status, 'DONE'),
          ),
        )
        // By position: the zone is a parameter, so the same expression written
        // twice would be two to Postgres.
        .groupBy(sql`1`);

      // When each issue still in it joined, by local day; one in it since
      // before this was kept counts from the cycle's first day.
      const joinedDay = sql<
        string | null
      >`to_char(${issues.cycleAddedAt} at time zone ${zone}::text, 'YYYY-MM-DD')`;
      const joined = await db
        .select({ day: joinedDay, count: sql<number>`count(*)::int` })
        .from(issues)
        .where(
          and(
            eq(issues.workspaceId, workspaceId),
            eq(issues.cycleId, cycleId),
            ne(issues.status, 'CANCELED'),
          ),
        )
        .groupBy(sql`1`);

      const today = todayIn(zone);
      const days = { startsOn: cycle.startsOn, endsOn: cycle.endsOn, today };
      return {
        startsOn: cycle.startsOn,
        endsOn: cycle.endsOn,
        today,
        planned,
        done: burnUp({ ...days, finished }),
        scope: burnUp({
          ...days,
          finished: joined.map((row) => ({ day: row.day ?? '', count: row.count })),
        }),
      };
    },
  );
}
