import {
  type Database,
  meetingAttendees,
  meetings,
  workspaceMembers,
  workspaces,
} from '@robis/database';
import { contracts, MY_MEETINGS_LIMIT, MY_MEETINGS_MAX_HOURS } from '@robis/shared';
import { and, asc, eq, isNull, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import { currentUser, requireAuth, requirePicture } from '../plugins/authz.ts';

/**
 * Your meetings across every workspace you are still in (the home's Today,
 * C5 idea 5): those you are invited to or organise, under way or starting in
 * the window, soonest first. The browser sends the window, as only it knows
 * where the person's day begins.
 */
export async function myMeetingRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  serve(
    app,
    contracts['meetings.mine'],
    { preHandler: [requireAuth, requirePicture] },
    async (request, { query }) => {
      const user = currentUser(request);
      const from = new Date(query.from);
      const to = new Date(query.to);
      const hours = (to.getTime() - from.getTime()) / 3_600_000;
      if (!(hours > 0) || hours > MY_MEETINGS_MAX_HOURS) {
        throw ApiError.badRequest(
          `The window must run forwards and be at most ${MY_MEETINGS_MAX_HOURS} hours`,
          'bad_window',
        );
      }

      const rows = await db
        .select({
          id: meetings.id,
          title: meetings.title,
          startsAt: meetings.startsAt,
          durationMinutes: meetings.durationMinutes,
          joinUrl: meetings.joinUrl,
          workspaceId: meetings.workspaceId,
          workspaceName: workspaces.name,
          myResponse: meetingAttendees.response,
        })
        .from(meetingAttendees)
        .innerJoin(meetings, eq(meetings.id, meetingAttendees.meetingId))
        .innerJoin(workspaces, eq(workspaces.id, meetings.workspaceId))
        // Still a member: an old invitation is no window into a workspace left.
        .innerJoin(
          workspaceMembers,
          and(
            eq(workspaceMembers.workspaceId, meetings.workspaceId),
            eq(workspaceMembers.userId, user.id),
          ),
        )
        .where(
          and(
            eq(meetingAttendees.userId, user.id),
            isNull(meetings.canceledAt),
            lt(meetings.startsAt, to),
            // Under way counts: it has not ended by the window's start.
            sql`${meetings.startsAt} + make_interval(mins => ${meetings.durationMinutes}) > ${from.toISOString()}::timestamptz`,
          ),
        )
        .orderBy(asc(meetings.startsAt), asc(meetings.id))
        .limit(MY_MEETINGS_LIMIT);

      return { meetings: rows };
    },
  );
}
