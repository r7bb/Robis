/**
 * Wire shapes for meetings, mirroring what `routes/meetings.ts` returns.
 *
 * Timestamps are ISO 8601 strings in UTC, which is how `timestamptz` arrives
 * over JSON -- they are parsed into a `Date` only at the point of display, by
 * the helpers in `lib/time.ts`. Keeping them as strings in the cache means
 * two renders of the same payload are `===` to each other, which `Date`
 * objects never are.
 */

export type MeetingResponse = 'pending' | 'yes' | 'no' | 'maybe';

export type MeetingAttendee = {
  userId: string;
  name: string;
  response: MeetingResponse;
};

export type Meeting = {
  id: string;
  title: string;
  agenda: string | null;
  /** e.g. "2026-10-09T14:30:00.000Z" */
  startsAt: string;
  durationMinutes: number;
  /** An organiser-supplied https link, or null when the meeting has no room. */
  joinUrl: string | null;
  /** Non-null once called off. The row is kept so the past view can say so. */
  canceledAt: string | null;
  /** Null when the organiser's account has since been deleted. */
  organizerId: string | null;
  organizerName: string | null;
  attendees: MeetingAttendee[];
};

export type NewMeeting = {
  title: string;
  agenda: string | null;
  /** ISO 8601, converted from the local-time value the organiser picked. */
  startsAt: string;
  durationMinutes: number;
  joinUrl: string | null;
  attendeeIds: string[];
};
