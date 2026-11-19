import { type Executor, knownDevices } from '@robis/database';
import { and, eq, lt, sql } from 'drizzle-orm';
import { generateSessionToken, hashSessionToken } from './tokens.ts';

/**
 * The browsers a person signs in from (C4).
 *
 * Each browser gets a random cookie of its own, apart from the session, that
 * outlives signing out. Kept here only as its hash, as a session is. A
 * sign-in from a browser not on the account's list, when the list is not
 * empty, is a new device and its owner is told by mail. An account with no
 * list yet (new, or from before this) simply starts one, so nobody is mailed
 * about the browser they have always used.
 */

export const DEVICE_COOKIE = 'robis_device';
export const HOST_DEVICE_COOKIE = '__Host-robis_device';
/** About as long as a browser keeps a cookie at all. */
export const DEVICE_TTL_MS = 400 * 24 * 60 * 60_000;

export function deviceCookieName(nodeEnv: string): string {
  return nodeEnv === 'production' ? HOST_DEVICE_COOKIE : DEVICE_COOKIE;
}

/** A device cookie's value: the same shape as a session token, and only ever a bearer of "seen before". */
const DEVICE_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;

export type NotedDevice = {
  /** The cookie to set, new or the one that came in. */
  token: string;
  /** A browser this account had not used, while it had used others: mail its owner. */
  isNewDevice: boolean;
};

/**
 * Note a sign-in's browser. Known: its last-seen time moves on. Unknown: it
 * is added, and is new to the account if the account already had any.
 */
export async function noteDevice(
  db: Executor,
  userId: string,
  cookie: string | undefined,
  now: Date = new Date(),
): Promise<NotedDevice> {
  const offered = cookie && DEVICE_TOKEN.test(cookie) ? cookie : null;
  if (offered) {
    const [seen] = await db
      .update(knownDevices)
      .set({ lastSeenAt: now })
      .where(
        and(
          eq(knownDevices.userId, userId),
          eq(knownDevices.deviceHash, hashSessionToken(offered)),
        ),
      )
      .returning({ id: knownDevices.id });
    if (seen) return { token: offered, isNewDevice: false };
  }

  // A cookie this server gave out, to this browser for another account, is
  // kept; one never given out (made up, or planted for the attacker to reuse
  // later) is replaced, so its value cannot become a known browser.
  const token = offered && (await wasGivenOut(db, offered)) ? offered : generateSessionToken();
  const deviceHash = hashSessionToken(token);
  const [other] = await db
    .select({ id: knownDevices.id })
    .from(knownDevices)
    .where(eq(knownDevices.userId, userId))
    .limit(1);
  const [added] = await db
    .insert(knownDevices)
    .values({ userId, deviceHash, lastSeenAt: now })
    .onConflictDoNothing()
    .returning({ id: knownDevices.id });
  // Two sign-ins racing from one new browser: the one that added it tells.
  return { token, isNewDevice: Boolean(other && added) };
}

async function wasGivenOut(db: Executor, token: string): Promise<boolean> {
  const [row] = await db
    .select({ id: knownDevices.id })
    .from(knownDevices)
    .where(eq(knownDevices.deviceHash, hashSessionToken(token)))
    .limit(1);
  return Boolean(row);
}

/**
 * Forget every browser an account has used: after "this was not me", all
 * are strangers. Retired rather than deleted: no cookie matches a retired
 * row, but the list is not empty, so the next sign-in anywhere, the
 * stranger's included, is a new device and mails another alert.
 */
export async function forgetDevices(db: Executor, userId: string): Promise<void> {
  await db
    .update(knownDevices)
    .set({ deviceHash: sql`'retired:' || ${knownDevices.id}::text` })
    .where(eq(knownDevices.userId, userId));
}

/** Housekeeping: browsers not seen for longer than their cookie lives. */
export async function deleteStaleDevices(db: Executor, now: Date = new Date()): Promise<number> {
  const removed = await db
    .delete(knownDevices)
    .where(lt(knownDevices.lastSeenAt, new Date(now.getTime() - DEVICE_TTL_MS)))
    .returning({ id: knownDevices.id });
  return removed.length;
}
