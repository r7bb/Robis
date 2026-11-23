import { generateSessionToken, hashSessionToken } from '@robis/auth';
import { calendarFeeds, type Database, twoFactor, users } from '@robis/database';
import { contracts } from '@robis/shared';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { calendarFile, type FeedEvent } from '../calendar/ics.ts';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import { myOccurrences, type Occurrence } from '../meetings/mine.ts';
import { currentUser, requireAuth } from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';

/**
 * Calendar feeds (B8). A person makes one private address; a calendar app
 * polls it for their meetings. The token in it is shown once and stored as
 * a hash; a new one replaces the old; revoking it deletes the row, so the
 * address answers 404 like any address that never existed.
 *
 * What the feed shows to whoever holds the address: the titles, agendas,
 * times and join links of that person's meetings, and each workspace's
 * name. That is the point of it, and why it can be revoked at any moment.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** A month back, so a calendar keeps last week; half a year ahead. */
const FEED_PAST_DAYS = 30;
const FEED_AHEAD_DAYS = 180;
/** Calendar apps poll every few minutes at most; this is far more. */
const FEED_READS_PER_MINUTE = 30;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** The headers the reset pages carry, for an address with a secret in it. */
const PRIVATE_URL_HEADERS = { 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' };

function feedEvent(occurrence: Occurrence, webOrigin: string): FeedEvent {
  const lines = [
    occurrence.agenda,
    occurrence.joinUrl ? `Join: ${occurrence.joinUrl}` : null,
    `In ${occurrence.workspaceName}, on Robis.`,
  ];
  return {
    uid: `${occurrence.id}-${occurrence.week}@robis`,
    start: occurrence.startsAt,
    minutes: occurrence.durationMinutes,
    title: occurrence.title,
    description: lines.filter((line) => line).join('\n\n'),
    url: webOrigin ? `${webOrigin}/workspaces/${occurrence.workspaceId}/meetings` : null,
    canceled: occurrence.canceledAt !== null,
    updatedAt: occurrence.updatedAt,
  };
}

/**
 * The feed's text for one person at a moment: their meetings from a month
 * before `now` to half a year after, each occurrence its own event. Apart
 * from the route so a test can fix `now` either side of a clock change.
 */
export async function feedText(
  db: Database,
  owner: { id: string; hasTwoFactor: boolean },
  now: Date,
  webOrigin: string,
): Promise<string> {
  const occurrences = await myOccurrences(db, owner, {
    from: new Date(now.getTime() - FEED_PAST_DAYS * DAY_MS),
    to: new Date(now.getTime() + FEED_AHEAD_DAYS * DAY_MS),
    includeCanceled: true,
  });
  return calendarFile(
    'Robis meetings',
    occurrences.map((occurrence) => feedEvent(occurrence, webOrigin)),
  );
}

/** Whose feed this token opens, and whether they have two-factor on; null for none. */
async function feedOwner(db: Database, token: string) {
  const [row] = await db
    .select({ userId: calendarFeeds.userId, confirmedAt: twoFactor.confirmedAt })
    .from(calendarFeeds)
    // A deleted account's feed is no feed, whatever is left behind.
    .innerJoin(users, and(eq(users.id, calendarFeeds.userId), isNull(users.deletedAt)))
    .leftJoin(
      twoFactor,
      and(eq(twoFactor.userId, calendarFeeds.userId), isNotNull(twoFactor.confirmedAt)),
    )
    .where(eq(calendarFeeds.tokenHash, hashSessionToken(token)))
    .limit(1);
  return row ? { id: row.userId, hasTwoFactor: row.confirmedAt !== null } : null;
}

export async function calendarRoutes(
  app: FastifyInstance,
  opts: { db: Database; webOrigin: string },
) {
  const { db, webOrigin } = opts;

  serve(app, contracts['calendar.feed'], { preHandler: [requireAuth] }, async (request) => {
    const [feed] = await db
      .select({ createdAt: calendarFeeds.createdAt })
      .from(calendarFeeds)
      .where(eq(calendarFeeds.userId, currentUser(request).id));
    return { feed: feed ?? null };
  });

  serve(
    app,
    contracts['calendar.createFeed'],
    { preHandler: [requireAuth] },
    async (request, _input, reply) => {
      const userId = currentUser(request).id;
      const token = generateSessionToken();
      const [feed] = await db
        .insert(calendarFeeds)
        .values({ userId, tokenHash: hashSessionToken(token) })
        .onConflictDoUpdate({
          target: calendarFeeds.userId,
          set: { tokenHash: hashSessionToken(token), createdAt: new Date() },
        })
        .returning({ createdAt: calendarFeeds.createdAt });
      reply.headers(PRIVATE_URL_HEADERS);
      return { feed: feed!, url: `${webOrigin}/api/calendar/${token}.ics` };
    },
  );

  serve(app, contracts['calendar.revokeFeed'], { preHandler: [requireAuth] }, async (request) => {
    await db.delete(calendarFeeds).where(eq(calendarFeeds.userId, currentUser(request).id));
    return undefined;
  });

  /*
   * The feed itself: calendar text, not JSON, so outside the contracts. An
   * unknown, malformed or revoked token is a 404, the same answer for each.
   */
  app.get<{ Params: { file: string } }>(
    '/calendar/:file',
    {
      onRequest: [
        // Per address rather than per caller: calendar services poll from
        // shared machines, and the store keeps only a hash of the key.
        rateLimit({
          name: 'calendar-feed',
          limit: FEED_READS_PER_MINUTE,
          windowMs: 60_000,
          key: (request) => `feed|${(request.params as { file?: string }).file ?? ''}`,
        }),
      ],
    },
    async (request, reply) => {
      const { file } = request.params;
      const token = file.endsWith('.ics') ? file.slice(0, -'.ics'.length) : '';
      const owner = TOKEN_SHAPE.test(token) ? await feedOwner(db, token) : null;
      if (!owner) throw ApiError.notFound('No such calendar');

      return reply
        .headers(PRIVATE_URL_HEADERS)
        .type('text/calendar; charset=utf-8')
        .send(await feedText(db, owner, new Date(), webOrigin));
    },
  );
}
