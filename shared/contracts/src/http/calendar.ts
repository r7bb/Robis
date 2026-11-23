import { z } from 'zod';
import { uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';

/**
 * Your calendar feed (B8): one private address a calendar app can poll for
 * your meetings, in every workspace you are in. The token is in the URL,
 * shown once, stored only as a hash; making a new one replaces the old,
 * and revoking it turns the address into a 404.
 */

const feed = z.object({ createdAt: timestamp });

export const calendarContracts = {
  'calendar.feed': contract({
    method: 'GET',
    path: '/me/calendar-feed',
    summary: 'Whether you have a calendar feed, and since when; never its address.',
    response: z.object({ feed: feed.nullable() }),
  }),
  'calendar.createFeed': contract({
    method: 'POST',
    path: '/me/calendar-feed',
    summary: 'Make your calendar feed, replacing any other; its address is shown this once.',
    status: 201,
    response: z.object({ feed, url: z.url() }),
  }),
  'meetings.import': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/meetings/import',
    summary:
      'Schedule the meetings in an .ics file, invitees matched to the roster by address; what cannot be taken is listed with why.',
    params: workspaceParams,
    /** Floating times in the file are read in this zone; the importer's own. */
    query: z.object({ timeZone: z.string().max(64).optional() }),
    rawBody: 'text/calendar',
    status: 201,
    response: z.object({
      found: z.number().int().nonnegative(),
      created: z.array(z.object({ id: uuid, title: z.string(), invited: z.number().int() })),
      skipped: z.array(z.object({ title: z.string().nullable(), reason: z.string() })),
      /**
       * True when the file named attendees and they were left off: only
       * someone who may invite members, and so sees everyone's address,
       * has them matched to people.
       */
      attendeesLeftOff: z.boolean(),
    }),
  }),
  'calendar.revokeFeed': contract({
    method: 'DELETE',
    path: '/me/calendar-feed',
    summary: 'Revoke your calendar feed: its address answers 404 from now on.',
    status: 204,
    response: null,
  }),
};
