import { type Database, issues, meetingAttendees, meetings, projects } from '@robis/database';
import { contracts, occurrencesBetween, WEEK_WINDOW_MAX_HOURS } from '@robis/shared';
import { and, asc, between, eq, isNull, lt, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import {
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';

/**
 * The week view (B8): every meeting in the workspace that has an
 * occurrence in the window, one row per occurrence, with the viewer's own
 * answer; and the issues due on the window's dates. Called-off meetings
 * and cancelled issues are left out. Anyone who may read meetings may
 * read this; issues come too, as every role that reads meetings reads them.
 */

/** A week of a busy workspace is far fewer of either. */
const ROWS_READ = 300;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = WEEK_WINDOW_MAX_HOURS / 24;

function checkWindow(from: Date, to: Date, firstDay: string, lastDay: string) {
  const hours = (to.getTime() - from.getTime()) / 3_600_000;
  const days = (Date.parse(lastDay) - Date.parse(firstDay)) / DAY_MS;
  if (!(hours > 0) || hours > WEEK_WINDOW_MAX_HOURS || !(days >= 0) || days > MAX_DAYS) {
    throw ApiError.badRequest(
      `The window must run forwards and be at most ${MAX_DAYS} days`,
      'bad_window',
    );
  }
}

async function weekMeetings(
  db: Database,
  workspaceId: string,
  userId: string,
  from: Date,
  to: Date,
) {
  const rows = await db
    .select({
      meetingId: meetings.id,
      title: meetings.title,
      startsAt: meetings.startsAt,
      durationMinutes: meetings.durationMinutes,
      timeZone: meetings.timeZone,
      repeatCount: meetings.repeatCount,
      myResponse: meetingAttendees.response,
    })
    .from(meetings)
    .leftJoin(
      meetingAttendees,
      and(eq(meetingAttendees.meetingId, meetings.id), eq(meetingAttendees.userId, userId)),
    )
    .where(
      and(
        eq(meetings.workspaceId, workspaceId),
        isNull(meetings.canceledAt),
        lt(meetings.startsAt, to),
        sql`${meetings.lastStartsAt} + make_interval(mins => ${meetings.durationMinutes}) > ${from.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(meetings.startsAt))
    .limit(ROWS_READ);
  return rows
    .flatMap(({ timeZone, ...row }) =>
      occurrencesBetween({ ...row, timeZone }, from, to).map((start) => ({
        ...row,
        startsAt: start,
        week: Math.round((start.getTime() - row.startsAt.getTime()) / (7 * DAY_MS)),
        myResponse: row.myResponse ?? null,
      })),
    )
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export async function weekRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  serve(
    app,
    contracts['calendar.week'],
    { preHandler: [requireAuth, requireMembership(db, 'meeting:read')] },
    async (request, { query }) => {
      const { workspaceId } = currentMembership(request);
      const from = new Date(query.from);
      const to = new Date(query.to);
      checkWindow(from, to, query.firstDay, query.lastDay);

      const [occurrences, due] = await Promise.all([
        weekMeetings(db, workspaceId, currentUser(request).id, from, to),
        db
          .select({
            id: issues.id,
            key: sql<string>`${projects.key} || '-' || ${issues.number}`,
            title: issues.title,
            status: issues.status,
            projectId: issues.projectId,
            dueOn: sql<string>`${issues.dueOn}::text`,
          })
          .from(issues)
          .innerJoin(projects, and(eq(projects.id, issues.projectId), eq(projects.archived, false)))
          .where(
            and(
              eq(issues.workspaceId, workspaceId),
              between(issues.dueOn, query.firstDay, query.lastDay),
              ne(issues.status, 'CANCELED'),
            ),
          )
          .orderBy(asc(issues.dueOn), asc(issues.number))
          .limit(ROWS_READ),
      ]);
      return { meetings: occurrences, issues: due };
    },
  );
}
