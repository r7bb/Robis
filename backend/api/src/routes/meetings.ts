import {
  type Database,
  meetingAttendees,
  meetings,
  publishEvent,
  recordAudit,
  users,
  workspaceMembers,
} from '@robis/database';
import {
  can,
  createMeetingSchema,
  isUuid,
  respondToMeetingSchema,
  updateMeetingSchema,
} from '@robis/shared';
import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors.ts';
import {
  auditActor,
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';
import { parse } from '../validate.ts';

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
  organizerId: string | null;
  canceledAt: Date | null;
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
      organizerId: meetings.organizerId,
      canceledAt: meetings.canceledAt,
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

  type AttendeeRow = { userId: string; name: string; response: string };

  app.get(
    '/workspaces/:workspaceId/meetings',
    { preHandler: [requireAuth, requireMembership(db, 'meeting:read')] },
    async (request) => {
      const { workspaceId } = currentMembership(request);
      const { scope } = request.query as { scope?: string };

      /*
       * "Upcoming" includes a meeting that started a little while ago.
       *
       * A call drops off the panel the instant it begins otherwise, which is
       * exactly when someone running late needs the join link. The cutoff is
       * on the start time rather than the computed end so the index on
       * `(workspace_id, starts_at)` can still serve it.
       */
      const cutoff = new Date(Date.now() - GRACE_MINUTES * 60_000);

      const timeFilter =
        scope === 'past'
          ? or(lt(meetings.startsAt, cutoff), sql`${meetings.canceledAt} is not null`)
          : and(gte(meetings.startsAt, cutoff), isNull(meetings.canceledAt));

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
        })
        .from(meetings)
        .leftJoin(users, eq(users.id, meetings.organizerId))
        .where(and(eq(meetings.workspaceId, workspaceId), timeFilter))
        .orderBy(scope === 'past' ? sql`${meetings.startsAt} desc` : asc(meetings.startsAt))
        .limit(50);

      const byMeeting = await attendeesFor(rows.map((row) => row.id));

      return {
        meetings: rows.map((row) => ({ ...row, attendees: byMeeting.get(row.id) ?? [] })),
      };
    },
  );

  app.post(
    '/workspaces/:workspaceId/meetings',
    { preHandler: [requireAuth, requireMembership(db, 'meeting:create')] },
    async (request, reply) => {
      const user = currentUser(request);
      const { workspaceId } = currentMembership(request);
      const input = parse(createMeetingSchema, request.body);

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

      return reply.status(201).send({ meeting: created });
    },
  );

  app.patch(
    '/workspaces/:workspaceId/meetings/:meetingId',
    { preHandler: [requireAuth, requireMembership(db, 'meeting:read')] },
    async (request) => {
      const user = currentUser(request);
      const { workspaceId, role } = currentMembership(request);
      const { meetingId } = request.params as { meetingId: string };
      const input = parse(updateMeetingSchema, request.body);

      const meeting = await loadMeeting(db, workspaceId, meetingId);
      assertCanManage(meeting, user.id, role);

      if (meeting.canceledAt) {
        throw ApiError.conflict('That meeting was cancelled', 'meeting_canceled');
      }

      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(meetings)
          .set({ ...input, updatedAt: new Date() })
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

      return { meeting: updated };
    },
  );

  /**
   * Cancel, rather than delete.
   *
   * A meeting that simply disappears tells the people who were planning
   * around it nothing. The row stays, marked, so the past view can show that
   * it was called off and by implication that it is not merely forgotten.
   */
  app.delete(
    '/workspaces/:workspaceId/meetings/:meetingId',
    { preHandler: [requireAuth, requireMembership(db, 'meeting:read')] },
    async (request, reply) => {
      const user = currentUser(request);
      const { workspaceId, role } = currentMembership(request);
      const { meetingId } = request.params as { meetingId: string };

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

      return reply.status(204).send();
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
  app.post(
    '/workspaces/:workspaceId/meetings/:meetingId/response',
    { preHandler: [requireAuth, requireMembership(db, 'meeting:read')] },
    async (request) => {
      const user = currentUser(request);
      const { workspaceId } = currentMembership(request);
      const { meetingId } = request.params as { meetingId: string };
      const input = parse(respondToMeetingSchema, request.body);

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

      return { ok: true, response: input.response };
    },
  );
}
