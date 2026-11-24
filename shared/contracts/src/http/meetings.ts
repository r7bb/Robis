import { z } from 'zod';
import { MEETING_NOTES_MAX_LENGTH } from '../follow-ups.ts';
import {
  createMeetingSchema,
  respondToMeetingSchema,
  updateMeetingSchema,
  uuid,
} from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';

/** The id stays a plain string: one that is not a meeting is a 404, not a 400. */
const meetingParams = workspaceParams.extend({ meetingId: z.string() });

/** A meeting's notes as read: what they say, and who saved them last. */
const meetingNotes = z.object({
  notes: z.string(),
  updatedAt: timestamp.nullable(),
  updatedByName: z.string().nullable(),
  canEdit: z.boolean(),
});

/** A meeting as it is stored: the plan, with no conferencing behind it. */
const meeting = z.object({
  id: uuid,
  title: z.string(),
  agenda: z.string().nullable(),
  startsAt: timestamp,
  durationMinutes: z.number().int(),
  /** An organiser-supplied https link, or null when the meeting has no room. */
  joinUrl: z.string().nullable(),
  /** Set once called off; the row is kept so the past view can say so. */
  canceledAt: timestamp.nullable(),
  /** Null when the organiser's account has since been deleted. */
  organizerId: uuid.nullable(),
  /** The organiser's zone, which a weekly repeat keeps its time of day in (B8). */
  timeZone: z.string(),
  /** Weekly occurrences in all; null for a one-off. */
  repeatCount: z.number().int().nullable(),
  /**
   * The next occurrence still to come (or under way), for a repeat; the
   * first, for a one-off. `startsAt` stays the first.
   */
  nextStartsAt: timestamp,
});

const attendee = z.object({
  userId: uuid,
  name: z.string(),
  response: z.enum(['pending', 'yes', 'no', 'maybe']),
});

/** The longest window `meetings.mine` answers for: a day and a day's grace. */
export const MY_MEETINGS_MAX_HOURS = 48;
export const MY_MEETINGS_LIMIT = 20;

export const meetingContracts = {
  'meetings.mine': contract({
    method: 'GET',
    path: '/me/meetings',
    summary:
      'Your meetings in a window (at most two days), in every workspace you are in, soonest first; called-off ones left out.',
    // The window comes from the browser, which knows where its day begins.
    query: z.object({
      from: z.iso.datetime({ offset: true }),
      to: z.iso.datetime({ offset: true }),
    }),
    response: z.object({
      meetings: z.array(
        meeting
          .pick({ id: true, title: true, startsAt: true, durationMinutes: true, joinUrl: true })
          .extend({
            workspaceId: uuid,
            workspaceName: z.string(),
            myResponse: z.enum(['pending', 'yes', 'no', 'maybe']),
          }),
      ),
    }),
  }),
  'meetings.list': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/meetings',
    summary:
      'Upcoming meetings, soonest first (and those that ended in the last half hour), or past and called-off ones, latest first.',
    params: workspaceParams,
    // Anything but `past` reads as upcoming, as it always has.
    query: z.object({ scope: z.enum(['upcoming', 'past']).catch('upcoming').optional() }),
    response: z.object({
      meetings: z.array(
        meeting.extend({ organizerName: z.string().nullable(), attendees: z.array(attendee) }),
      ),
    }),
  }),
  'meetings.create': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/meetings',
    summary: 'Schedule a meeting; the organiser is an attendee who has said yes.',
    params: workspaceParams,
    body: createMeetingSchema,
    status: 201,
    response: z.object({ meeting }),
  }),
  'meetings.update': contract({
    method: 'PATCH',
    path: '/workspaces/:workspaceId/meetings/:meetingId',
    summary: 'Change a meeting you organise, or call it off.',
    params: meetingParams,
    body: updateMeetingSchema,
    response: z.object({ meeting }),
  }),
  'meetings.delete': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/meetings/:meetingId',
    summary: 'Delete a meeting you organise.',
    params: meetingParams,
    status: 204,
    response: null,
  }),
  'meetings.respond': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/meetings/:meetingId/response',
    summary: 'Say whether you are coming.',
    params: meetingParams,
    body: respondToMeetingSchema,
    response: z.object({ ok: z.literal(true), response: z.enum(['yes', 'no', 'maybe']) }),
  }),
  'meetings.notes': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/meetings/:meetingId/notes',
    summary: 'A meeting’s notes, who last saved them and when, and whether you may write them.',
    params: meetingParams,
    response: meetingNotes,
  }),
  'meetings.saveNotes': contract({
    method: 'PUT',
    path: '/workspaces/:workspaceId/meetings/:meetingId/notes',
    summary:
      'Save a meeting’s notes, for anyone in it. With the time they were read, a save over someone else’s since is refused, not lost.',
    params: meetingParams,
    body: z.object({
      notes: z.string().max(MEETING_NOTES_MAX_LENGTH),
      /**
       * When the notes being replaced were saved, as read; null when they
       * never were. Always sent, so no save can skip the check.
       */
      basedOn: timestamp.nullable(),
    }),
    response: meetingNotes,
  }),
} as const;
