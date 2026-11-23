import type { Database } from '@robis/database';
import { contracts, MY_MEETINGS_LIMIT, MY_MEETINGS_MAX_HOURS } from '@robis/shared';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import { myOccurrences } from '../meetings/mine.ts';
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

      const occurrences = await myOccurrences(db, user, { from, to, includeCanceled: false });
      // One row per occurrence, so a weekly meeting shows on each of its days (B8).
      const rows = occurrences
        .slice(0, MY_MEETINGS_LIMIT)
        .map(
          ({
            id,
            title,
            startsAt,
            durationMinutes,
            joinUrl,
            workspaceId,
            workspaceName,
            myResponse,
          }) => ({
            id,
            title,
            startsAt,
            durationMinutes,
            joinUrl,
            workspaceId,
            workspaceName,
            myResponse,
          }),
        );

      return { meetings: rows };
    },
  );
}
