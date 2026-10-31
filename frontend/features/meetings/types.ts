import type { BodyOf, contracts, ResponseOf } from '@robis/shared';

/**
 * Meetings as the API's contracts describe them
 * (`shared/contracts/src/http/meetings.ts`).
 *
 * Timestamps are ISO 8601 strings in UTC, which is how `timestamptz` arrives
 * over JSON -- they are parsed into a `Date` only at the point of display, by
 * the helpers in `lib/time.ts`. Keeping them as strings in the cache means
 * two renders of the same payload are `===` to each other, which `Date`
 * objects never are.
 */

export type Meeting = ResponseOf<(typeof contracts)['meetings.list']>['meetings'][number];

type MeetingAttendee = Meeting['attendees'][number];

/** Where an attendee stands: `pending` until they answer. */
export type MeetingResponse = MeetingAttendee['response'];

/** What an attendee can answer with. */
export type MeetingAnswer = BodyOf<(typeof contracts)['meetings.respond']>['response'];

export type NewMeeting = BodyOf<(typeof contracts)['meetings.create']>;
