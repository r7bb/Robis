import { z } from 'zod';
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
  'calendar.revokeFeed': contract({
    method: 'DELETE',
    path: '/me/calendar-feed',
    summary: 'Revoke your calendar feed: its address answers 404 from now on.',
    status: 204,
    response: null,
  }),
};
