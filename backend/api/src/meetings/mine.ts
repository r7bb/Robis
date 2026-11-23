import type { AuthenticatedUser } from '@robis/auth';
import {
  type Database,
  meetingAttendees,
  meetings,
  workspaceMembers,
  workspaces,
} from '@robis/database';
import { occurrencesBetween } from '@robis/shared';
import { and, asc, desc, eq, isNull, lt, sql } from 'drizzle-orm';

/**
 * One person's meetings across every workspace they are still in, as
 * occurrences in a window (B8): what the home's Today and the calendar feed
 * both show. Only meetings they were invited to or organise, and nothing
 * from a workspace that requires two-factor until they have it.
 */

/** Generous: one person's meetings over the feed's window. */
const ROWS_READ = 500;

export type Occurrence = {
  id: string;
  title: string;
  agenda: string | null;
  /** This occurrence's start. */
  startsAt: Date;
  durationMinutes: number;
  joinUrl: string | null;
  workspaceId: string;
  workspaceName: string;
  myResponse: 'pending' | 'yes' | 'no' | 'maybe';
  canceledAt: Date | null;
  /** Which week of a repeat this is, from 0; always 0 for a one-off. */
  week: number;
  updatedAt: Date;
};

export async function myOccurrences(
  db: Database,
  user: Pick<AuthenticatedUser, 'id' | 'hasTwoFactor'>,
  window: { from: Date; to: Date; includeCanceled: boolean },
): Promise<Occurrence[]> {
  const rows = await db
    .select({
      id: meetings.id,
      title: meetings.title,
      agenda: meetings.agenda,
      startsAt: meetings.startsAt,
      durationMinutes: meetings.durationMinutes,
      joinUrl: meetings.joinUrl,
      timeZone: meetings.timeZone,
      repeatCount: meetings.repeatCount,
      canceledAt: meetings.canceledAt,
      updatedAt: meetings.updatedAt,
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
        user.hasTwoFactor ? undefined : eq(workspaces.requireTwoFactor, false),
        window.includeCanceled ? undefined : isNull(meetings.canceledAt),
        lt(meetings.startsAt, window.to),
        // Some occurrence has not ended by the window's start.
        sql`${meetings.lastStartsAt} + make_interval(mins => ${meetings.durationMinutes}) > ${window.from.toISOString()}::timestamptz`,
      ),
    )
    // Past the cap, the series that ended longest ago are the ones left out.
    .orderBy(desc(meetings.lastStartsAt), asc(meetings.id))
    .limit(ROWS_READ);

  return rows
    .flatMap(({ timeZone, repeatCount, ...row }) => {
      const all = occurrencesBetween(
        { startsAt: row.startsAt, durationMinutes: row.durationMinutes, timeZone, repeatCount },
        window.from,
        window.to,
      );
      return all.map((start) => ({
        ...row,
        startsAt: start,
        week: Math.round((start.getTime() - row.startsAt.getTime()) / (7 * 24 * 3_600_000)),
      }));
    })
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));
}
