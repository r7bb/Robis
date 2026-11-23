import {
  type Database,
  type Executor,
  enqueue,
  type MeetingChange,
  type MeetingJob,
  meetingAttendees,
  meetings,
  NOTIFY_MEETING_JOB,
  noticeWindow,
  publishEvent,
  recordAudit,
  users,
  workspaceMembers,
} from '@robis/database';
import { can, contracts, isUuid } from '@robis/shared';
import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import { lastStartOf, withNext } from '../meetings/schedule.ts';
import {
  auditActor,
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';

/**
 * Scheduled meetings.
 *
 * Robis stores the plan and nothing else. There is no conferencing provider
 * behind this: `joinUrl` is a link the organiser supplies, validated only as
 * an https URL. Minting rooms on someone's service would put a third-party
 * dependency -- and that provider's data handling -- on the request path for
 * a feature whose real job is "everyone can see what is happening when".
 */

/** How long a finished meeting keeps showing in the upcoming list. */
const GRACE_MINUTES = 30;

type MeetingRow = {
  id: string;
  title: string;
  startsAt: Date;
  durationMinutes: number;
  joinUrl: string | null;
  organizerId: string | null;
  canceledAt: Date | null;
  timeZone: string;
  repeatCount: number | null;
};

async function loadMeeting(
  db: Database,
  workspaceId: string,
  meetingId: string,
): Promise<MeetingRow> {
  if (!isUuid(meetingId)) throw ApiError.notFound('Meeting not found');

  const [meeting] = await db
    .select({
      id: meetings.id,
      title: meetings.title,
      startsAt: meetings.startsAt,
      durationMinutes: meetings.durationMinutes,
      joinUrl: meetings.joinUrl,
      organizerId: meetings.organizerId,
      canceledAt: meetings.canceledAt,
      timeZone: meetings.timeZone,
      repeatCount: meetings.repeatCount,
    })
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.workspaceId, workspaceId)))
    .limit(1);

  if (!meeting) throw ApiError.notFound('Meeting not found');
  return meeting;
}

/**
 * Organisers manage their own meetings; admins manage anyone's.
 *
 * The organiser may be null -- their account was deleted -- in which case
 * only the `manage_any` holders are left, which is the right answer: an
 * orphaned meeting should not be editable by whoever happens to be looking.
 */
function assertCanManage(meeting: MeetingRow, userId: string, role: Parameters<typeof can>[0]) {
  const isOrganizer = meeting.organizerId !== null && meeting.organizerId === userId;
  const allowed = isOrganizer ? can(role, 'meeting:manage_own') : can(role, 'meeting:manage_any');

  if (!allowed) throw ApiError.forbidden();
}

type Shape = Pick<MeetingRow, 'title' | 'startsAt' | 'durationMinutes' | 'joinUrl'>;

/**
 * What an edit did, as attendees would care (C3): a new time or length moved
 * it, a new title or link changed it. An agenda edit, or a save that left
 * everything as it was, is no news.
 */
function meetingChange(before: Shape, after: Shape): MeetingChange | null {
  if (
    before.startsAt.getTime() !== after.startsAt.getTime() ||
    before.durationMinutes !== after.durationMinutes
  ) {
    return 'moved';
  }
  return before.title !== after.title || before.joinUrl !== after.joinUrl ? 'changed' : null;
}

/**
 * Tell the attendees a meeting moved, changed or was called off (C3). Edits
 * of one kind inside one notice window are one notice (`noticeWindow`), so a
 * meeting moved ten times in a minute tells people once, at its last time.
 */
async function queueMeetingNotice(
  tx: Executor,
  meetingId: string,
  change: MeetingChange,
  actorId: string,
) {
  const when = change === 'canceled' ? 'once' : noticeWindow();
  const job: MeetingJob = { meetingId, change, actorId, eventId: `${meetingId}:${change}:${when}` };
  await enqueue(tx, NOTIFY_MEETING_JOB, job);
}

/**
 * A meeting's next start as SQL, to within the hour a clock change moves
 * it (B8): a one-off's start, or a repeat's first start plus whole weeks
 * up to `cutoff`. Orders the upcoming page so it holds the soonest fifty;
 * the exact order is set from the shared occurrence rules after.
 */
function nextStartSql(cutoff: Date) {
  const at = sql`${cutoff.toISOString()}::timestamptz`;
  return sql`case when ${meetings.repeatCount} is null or ${meetings.startsAt} >= ${at}
    then ${meetings.startsAt}
    else ${meetings.startsAt} + ceil(extract(epoch from (${at} - ${meetings.startsAt})) / 604800) * interval '7 days'
  end`;
}

export async function meetingRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  /**
   * Attendees for a set of meetings, in one query.
   *
   * Fetched as a batch and grouped in memory rather than per meeting: the
   * list endpoint returns a page of meetings, and a query per row is the
   * textbook N+1.
   */
  async function attendeesFor(meetingIds: string[]) {
    if (meetingIds.length === 0) return new Map<string, AttendeeRow[]>();

    const rows = await db
      .select({
        meetingId: meetingAttendees.meetingId,
        userId: meetingAttendees.userId,
        name: users.name,
        response: meetingAttendees.response,
      })
      .from(meetingAttendees)
      .innerJoin(users, eq(users.id, meetingAttendees.userId))
      .where(inArray(meetingAttendees.meetingId, meetingIds))
      .orderBy(asc(users.name));

    const byMeeting = new Map<string, AttendeeRow[]>();
    for (const row of rows) {
      const { meetingId, ...attendee } = row;
      const bucket = byMeeting.get(meetingId);
      if (bucket) bucket.push(attendee);
      else byMeeting.set(meetingId, [attendee]);
    }

    return byMeeting;
  }

  type AttendeeRow = {
    userId: string;
    name: string;
    response: (typeof meetingAttendees.$inferSelect)['response'];
  };

  serve(
    app,
    contracts['meetings.list'],
    { preHandler: [requireAuth, requireMembership(db, 'meeting:read')] },
    async (request, { query: { scope } }) => {
      const { workspaceId } = currentMembership(request);

      /*
       * "Upcoming" includes a meeting that started a little while ago.
       *
       * A call drops off the panel the instant it begins otherwise, which is
       * exactly when someone running late needs the join link. The cutoff is
       * on the start time rather than the computed end so the index on
       * `(workspace_id, starts_at)` can still serve it.
       */
      const cutoff = new Date(Date.now() - GRACE_MINUTES * 60_000);

      // On the last occurrence's start, so a weekly meeting stays upcoming
      // until its last week (B8).
      const timeFilter =
        scope === 'past'
          ? or(lt(meetings.lastStartsAt, cutoff), sql`${meetings.canceledAt} is not null`)
          : and(gte(meetings.lastStartsAt, cutoff), isNull(meetings.canceledAt));

      const rows = await db
        .select({
          id: meetings.id,
          title: meetings.title,
          agenda: meetings.agenda,
          startsAt: meetings.startsAt,
          durationMinutes: meetings.durationMinutes,
          joinUrl: meetings.joinUrl,
          canceledAt: meetings.canceledAt,
          organizerId: meetings.organizerId,
          organizerName: users.name,
          timeZone: meetings.timeZone,
          repeatCount: meetings.repeatCount,
        })
        .from(meetings)
        .leftJoin(users, eq(users.id, meetings.organizerId))
        .where(and(eq(meetings.workspaceId, workspaceId), timeFilter))
        .orderBy(scope === 'past' ? sql`${meetings.lastStartsAt} desc` : nextStartSql(cutoff))
        .limit(50);

      const byMeeting = await attendeesFor(rows.map((row) => row.id));
      const timed = rows.map((row) => withNext(row, cutoff));
      // Upcoming by the next occurrence: a weekly one comes round again.
      if (scope !== 'past')
        timed.sort((a, b) => a.nextStartsAt.getTime() - b.nextStartsAt.getTime());

      return {
        meetings: timed.map((row) => ({ ...row, attendees: byMeeting.get(row.id) ?? [] })),
      };
    },
  );

  serve(
    app,
    contracts['meetings.create'],
    { preHandler: [requireAuth, requireMembership(db, 'meeting:create')] },
    async (request, { body: input }) => {
      const user = currentUser(request);
      const { workspaceId } = currentMembership(request);

      /*
       * Invitees are intersected with the workspace roster.
       *
       * The ids arrive from the client, so taking them at face value would
       * let a member attach arbitrary users to a meeting -- a way to put a
       * row in a stranger's calendar, and to confirm that a given user id
       * exists. The intersection makes both impossible, and quietly drops
       * anything that does not belong rather than leaking which ids were bad.
       */
      const requested = new Set(input.attendeeIds ?? []);
      requested.delete(user.id);

      const invitees =
        requested.size > 0
          ? await db
              .select({ userId: workspaceMembers.userId })
              .from(workspaceMembers)
              .where(
                and(
                  eq(workspaceMembers.workspaceId, workspaceId),
                  inArray(workspaceMembers.userId, [...requested]),
                ),
              )
          : [];

      const created = await db.transaction(async (tx) => {
        const [meeting] = await tx
          .insert(meetings)
          .values({
            workspaceId,
            title: input.title,
            agenda: input.agenda ?? null,
            startsAt: input.startsAt,
            durationMinutes: input.durationMinutes,
            joinUrl: input.joinUrl ?? null,
            organizerId: user.id,
            timeZone: input.timeZone,
            repeatCount: input.repeatCount ?? null,
            lastStartsAt: lastStartOf({
              startsAt: input.startsAt,
              durationMinutes: input.durationMinutes,
              timeZone: input.timeZone,
              repeatCount: input.repeatCount ?? null,
            }),
          })
          .returning();

        // The organiser attends their own meeting, already answered. Anyone
        // else starts at `pending`, which is a real state: "not replied" is
        // not the same as "declined".
        await tx
          .insert(meetingAttendees)
          .values([
            { meetingId: meeting!.id, userId: user.id, response: 'yes', respondedAt: new Date() },
            ...invitees.map((invitee) => ({ meetingId: meeting!.id, userId: invitee.userId })),
          ]);

        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'meeting',
          entityId: meeting!.id,
          eventType: 'meeting.created',
          payload: {
            title: meeting!.title,
            startsAt: meeting!.startsAt.toISOString(),
            invited: invitees.length,
          },
        });

        return meeting!;
      });

      await publishEvent(db, {
        type: 'meeting.changed',
        workspaceId,
        meetingId: created.id,
        actorId: user.id,
      });

      return { meeting: withNext(created, new Date()) };
    },
  );

  serve(
    app,
    contracts['meetings.update'],
    { preHandler: [requireAuth, requireMembership(db, 'meeting:read')] },
    async (request, { params: { meetingId }, body: input }) => {
      const user = currentUser(request);
      const { workspaceId, role } = currentMembership(request);

      const meeting = await loadMeeting(db, workspaceId, meetingId);
      assertCanManage(meeting, user.id, role);

      if (meeting.canceledAt) {
        throw ApiError.conflict('That meeting was cancelled', 'meeting_canceled');
      }

      // The schedule as it will be, so the last start is kept true (B8).
      const schedule = {
        startsAt: input.startsAt ?? meeting.startsAt,
        durationMinutes: input.durationMinutes ?? meeting.durationMinutes,
        timeZone: input.timeZone ?? meeting.timeZone,
        repeatCount: input.repeatCount !== undefined ? input.repeatCount : meeting.repeatCount,
      };

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(meetings)
          .set({ ...input, lastStartsAt: lastStartOf(schedule), updatedAt: new Date() })
          .where(and(eq(meetings.id, meetingId), eq(meetings.workspaceId, workspaceId)))
          .returning();

        if (!row) throw ApiError.notFound('Meeting not found');

        /*
         * Moving a meeting resets everyone else's answer.
         *
         * "Yes" meant yes to a particular time. Carrying it across a reschedule
         * would show the organiser a room full of confirmed attendees who never
         * agreed to the new slot. The organiser's own row is left alone.
         */
        if (input.startsAt) {
          await tx
            .update(meetingAttendees)
            .set({ response: 'pending', respondedAt: null })
            .where(
              and(
                eq(meetingAttendees.meetingId, meetingId),
                sql`${meetingAttendees.userId} <> ${user.id}::uuid`,
              ),
            );
        }

        const change = meetingChange(meeting, row);
        if (change) await queueMeetingNotice(tx, meetingId, change, user.id);

        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'meeting',
          entityId: meetingId,
          eventType: 'meeting.updated',
          payload: {
            title: row.title,
            fields: Object.keys(input),
            ...(input.startsAt
              ? { from: meeting.startsAt.toISOString(), to: input.startsAt.toISOString() }
              : {}),
          },
        });

        return row;
      });

      await publishEvent(db, {
        type: 'meeting.changed',
        workspaceId,
        meetingId,
        actorId: user.id,
      });

      return { meeting: withNext(updated, new Date()) };
    },
  );

  /**
   * Cancel, rather than delete.
   *
   * A meeting that simply disappears tells the people who were planning
   * around it nothing. The row stays, marked, so the past view can show that
   * it was called off and by implication that it is not merely forgotten.
   */
  serve(
    app,
    contracts['meetings.delete'],
    { preHandler: [requireAuth, requireMembership(db, 'meeting:read')] },
    async (request, { params: { meetingId } }) => {
      const user = currentUser(request);
      const { workspaceId, role } = currentMembership(request);

      const meeting = await loadMeeting(db, workspaceId, meetingId);
      assertCanManage(meeting, user.id, role);

      await db.transaction(async (tx) => {
        const canceled = await tx
          .update(meetings)
          .set({ canceledAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(meetings.id, meetingId),
              eq(meetings.workspaceId, workspaceId),
              // Keeps the first cancellation's timestamp if this runs twice.
              isNull(meetings.canceledAt),
            ),
          )
          .returning({ id: meetings.id });

        // A repeat cancel changed nothing, so it records nothing.
        if (canceled.length === 0) return;
        await queueMeetingNotice(tx, meetingId, 'canceled', user.id);

        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'meeting',
          entityId: meetingId,
          eventType: 'meeting.canceled',
          payload: { title: meeting.title, startsAt: meeting.startsAt.toISOString() },
        });
      });

      await publishEvent(db, {
        type: 'meeting.changed',
        workspaceId,
        meetingId,
        actorId: user.id,
      });

      return undefined;
    },
  );

  /**
   * RSVP.
   *
   * Always for the caller: there is no user id in the payload, so one person
   * cannot answer on another's behalf. Upserted because anyone who can read
   * the meeting may reply to it, including a member who was never explicitly
   * invited -- a workspace-wide meeting has no invite list to be on.
   */
  serve(
    app,
    contracts['meetings.respond'],
    { preHandler: [requireAuth, requireMembership(db, 'meeting:read')] },
    async (request, { params: { meetingId }, body: input }) => {
      const user = currentUser(request);
      const { workspaceId } = currentMembership(request);

      const meeting = await loadMeeting(db, workspaceId, meetingId);

      if (meeting.canceledAt) {
        throw ApiError.conflict('That meeting was cancelled', 'meeting_canceled');
      }

      await db.transaction(async (tx) => {
        await tx
          .insert(meetingAttendees)
          .values({
            meetingId,
            userId: user.id,
            response: input.response,
            respondedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [meetingAttendees.meetingId, meetingAttendees.userId],
            set: { response: input.response, respondedAt: new Date() },
          });

        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'meeting',
          entityId: meetingId,
          eventType: 'meeting.responded',
          payload: { title: meeting.title, response: input.response },
        });
      });

      return { ok: true as const, response: input.response };
    },
  );
}
