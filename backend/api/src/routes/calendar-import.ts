import { type Database, meetings, publishEvent, users, workspaceMembers } from '@robis/database';
import { can, canonicalZone, contracts } from '@robis/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type ImportedMeeting, parseCalendar } from '../calendar/parse.ts';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import { insertMeeting } from '../meetings/create.ts';
import {
  auditActor,
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';

/**
 * Importing meetings from an .ics file (B8). Each event becomes a meeting
 * organised by the importer, exactly as if scheduled here.
 *
 * Attendees are matched to this workspace's people by address only for
 * someone who may invite members, who can already see everyone's address.
 * For anyone else the file's attendees are left off: matching them would
 * tell a member which addresses belong to whom, which the member list
 * deliberately does not. Invitees are capped as scheduling caps them.
 */

/** A year of a busy calendar's meetings is far smaller than this. */
const IMPORT_MAX_BYTES = 256 * 1024;
const IMPORTS_PER_MINUTE = 10;
/** As many invitees as one scheduled meeting may have. */
const INVITEES_MAX = 200;

/** Members of the workspace whose address is one of `emails`. */
async function membersByEmail(db: Database, workspaceId: string, emails: string[]) {
  if (emails.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ userId: users.id, email: users.email })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        inArray(sql`lower(${users.email})`, emails),
      ),
    );
  return new Map(rows.map((row) => [row.email.toLowerCase(), row.userId]));
}

/**
 * The meetings in a file not already in the workspace, by title and start:
 * importing the same file twice brings nothing new the second time.
 */
async function notYetHere(db: Database, workspaceId: string, found: ImportedMeeting[]) {
  if (found.length === 0) return [];
  const existing = await db
    .select({ title: meetings.title, startsAt: meetings.startsAt })
    .from(meetings)
    .where(
      and(
        eq(meetings.workspaceId, workspaceId),
        inArray(
          meetings.startsAt,
          found.map((meeting) => meeting.startsAt),
        ),
      ),
    );
  const here = new Set(existing.map((row) => `${row.title}\u0000${row.startsAt.getTime()}`));
  return found.filter(
    (meeting) => !here.has(`${meeting.title}\u0000${meeting.startsAt.getTime()}`),
  );
}

/**
 * Turned away before the body is read: no credentials at all, or a file
 * larger than the limit, so nobody makes the server hold 256 KB for nothing.
 */
async function admitImport(request: FastifyRequest) {
  if (Number(request.headers['content-length'] ?? 0) > IMPORT_MAX_BYTES) {
    throw new ApiError(413, 'payload_too_large', 'That file is larger than 256 KB');
  }
  if (!request.headers.cookie && !request.headers.authorization) throw ApiError.unauthorized();
}

export async function calendarImportRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;
  // Only this plugin's routes take calendar text.
  app.addContentTypeParser(
    'text/calendar',
    { parseAs: 'string', bodyLimit: IMPORT_MAX_BYTES },
    (_request, body, done) => done(null, body),
  );

  serve(
    app,
    contracts['meetings.import'],
    {
      onRequest: [admitImport],
      preHandler: [
        requireAuth,
        requireMembership(db, 'meeting:create'),
        rateLimit({ name: 'meetings-import', limit: IMPORTS_PER_MINUTE, windowMs: 60_000 }),
      ],
    },
    async (request, { query }, reply) => {
      const user = currentUser(request);
      const { workspaceId, role } = currentMembership(request);
      if (typeof request.body !== 'string' || request.body.length === 0) {
        throw ApiError.badRequest('Send the .ics file as text/calendar', 'not_a_calendar');
      }
      const zone = canonicalZone(query.timeZone ?? 'UTC');
      if (!zone) throw ApiError.badRequest('Not a time zone this server knows', 'bad_time_zone');
      const parsed = parseCalendar(request.body, zone);
      if (parsed.found === 0) throw ApiError.badRequest('That file holds no events', 'no_events');

      const matching = can(role, 'member:invite');
      const emails = matching
        ? [...new Set(parsed.meetings.flatMap((meeting) => meeting.attendeeEmails))]
        : [];
      const members = await membersByEmail(db, workspaceId, emails);
      const fresh = await notYetHere(db, workspaceId, parsed.meetings);
      const skipped = [
        ...parsed.skipped,
        ...parsed.meetings
          .filter((meeting) => !fresh.includes(meeting))
          .map((meeting) => ({ title: meeting.title, reason: 'it is already here' })),
      ];
      const actor = { ...auditActor(request), id: user.id };

      const created = await db.transaction(async (tx) => {
        const made: { id: string; title: string; invited: number }[] = [];
        for (const { attendeeEmails, ...meeting } of fresh) {
          const invitees = [...new Set(attendeeEmails.flatMap((email) => members.get(email) ?? []))]
            .filter((id) => id !== user.id)
            .slice(0, INVITEES_MAX);
          const row = await insertMeeting(tx, actor, workspaceId, meeting, invitees, 'imported');
          made.push({ id: row.id, title: row.title, invited: invitees.length });
        }
        return made;
      });

      // Saved already: a live update that fails to go out is logged, not an error.
      for (const meeting of created) {
        await publishEvent(db, {
          type: 'meeting.changed',
          workspaceId,
          meetingId: meeting.id,
          actorId: user.id,
        }).catch((error) =>
          request.log.warn({ err: error }, 'an imported meeting was not announced'),
        );
      }
      reply.status(201);
      const named = parsed.meetings.some((meeting) => meeting.attendeeEmails.length > 0);
      return { found: parsed.found, created, skipped, attendeesLeftOff: named && !matching };
    },
  );
}
