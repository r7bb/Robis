import { z } from 'zod';
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
});

const attendee = z.object({
  userId: uuid,
  name: z.string(),
  response: z.enum(['pending', 'yes', 'no', 'maybe']),
});

export const meetingContracts = {
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
} as const;
