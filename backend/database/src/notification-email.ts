import { createHash, randomBytes } from 'node:crypto';
import type { NotificationKind } from '@robis/shared';
import { and, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Executor } from './index.ts';
import { queueDigestMail } from './mail-jobs.ts';
import { setSetting } from './notify.ts';
import { emailDigests, notifications, unsubscribeTokens } from './schema.ts';

/**
 * Notifications by email (C3): the day's summary, and the links that stop
 * them. A mention goes at once by its own job; everything else waits for a
 * digest, at most one per person per day.
 */

/**
 * Digests go out from this hour (UTC) each day: one email a day, at a time
 * that is morning in Europe and the small hours in the Americas. A fixed
 * hour rather than each person's own, as Robis does not know where anyone is.
 */
export const DIGEST_HOUR_UTC = 8;

/** The UTC date of a moment, `YYYY-MM-DD`. */
function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Queue today's digest for everyone with something waiting who has not had
 * one today, once the digest hour has come. Run hourly; a person's later
 * news that day waits for tomorrow's. Returns how many were queued.
 */
export async function scanDigests(db: Executor, now = new Date()): Promise<number> {
  if (now.getUTCHours() < DIGEST_HOUR_UTC) return 0;
  const day = utcDay(now);
  const due = await db
    .selectDistinct({ userId: notifications.userId })
    .from(notifications)
    .where(
      and(
        eq(notifications.emailDue, 'digest'),
        isNull(notifications.emailedAt),
        sql`not exists (select 1 from ${emailDigests} d where d.user_id = ${notifications.userId} and d.day = ${day})`,
      ),
    );
  for (const { userId } of due) await queueDigestMail(db, userId, day);
  return due.length;
}

/**
 * The digest for one person and day, made on first asking: the
 * notifications waiting now are fixed into it, so every retry sends the
 * same email. Null once it has been sent.
 */
export async function claimDigest(
  db: Executor,
  userId: string,
  day: string,
): Promise<{ notificationIds: string[] } | null> {
  const waiting = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.emailDue, 'digest'),
        isNull(notifications.emailedAt),
      ),
    );
  await db
    .insert(emailDigests)
    .values({ userId, day, notificationIds: JSON.stringify(waiting.map((w) => w.id)) })
    .onConflictDoNothing();
  const [digest] = await db
    .select()
    .from(emailDigests)
    .where(and(eq(emailDigests.userId, userId), eq(emailDigests.day, day)));
  if (!digest || digest.sentAt) return null;
  return { notificationIds: JSON.parse(digest.notificationIds) as string[] };
}

/** The digest went (or had nothing left to say): never again, and its notifications are done. */
export async function markDigestSent(
  db: Executor,
  userId: string,
  day: string,
  ids: readonly string[],
) {
  const now = new Date();
  // Together: a digest marked sent with its notifications not would bring
  // them back in tomorrow's.
  await db.transaction(async (tx) => {
    await tx
      .update(emailDigests)
      .set({ sentAt: now })
      .where(and(eq(emailDigests.userId, userId), eq(emailDigests.day, day)));
    await markEmailed(tx, ids, now);
  });
}

/** These notifications went by email, or were passed over: not again. */
export async function markEmailed(db: Executor, ids: readonly string[], now = new Date()) {
  if (ids.length === 0) return;
  await db
    .update(notifications)
    .set({ emailedAt: now })
    .where(and(inArray(notifications.id, [...ids]), isNull(notifications.emailedAt)));
}

/**
 * How long an unsubscribe link works: comfortably past the thirty days
 * after sending that a mailing must honour one for.
 */
export const UNSUBSCRIBE_TOKEN_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** A link's secret for one email: it can only turn email off for these kinds, for this person. */
export async function issueUnsubscribeToken(
  db: Executor,
  userId: string,
  kinds: readonly NotificationKind[],
  now = new Date(),
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(unsubscribeTokens).values({
    tokenHash: hashToken(token),
    userId,
    kinds: JSON.stringify([...new Set(kinds)]),
    expiresAt: new Date(now.getTime() + UNSUBSCRIBE_TOKEN_DAYS * DAY_MS),
  });
  return token;
}

/** What a link would stop, without using it; null for one that is gone or never was. */
export async function previewUnsubscribe(
  db: Executor,
  token: string,
  now = new Date(),
): Promise<NotificationKind[] | null> {
  const [row] = await db
    .select({ kinds: unsubscribeTokens.kinds })
    .from(unsubscribeTokens)
    .where(
      and(eq(unsubscribeTokens.tokenHash, hashToken(token)), gt(unsubscribeTokens.expiresAt, now)),
    );
  return row ? (JSON.parse(row.kinds) as NotificationKind[]) : null;
}

/**
 * Use a link: email off for its kinds, and the link gone, in one step (the
 * delete is the claim, so two clicks at once turn things off once). Null
 * for one that is gone or never was.
 */
export async function redeemUnsubscribe(
  db: Executor,
  token: string,
  now = new Date(),
): Promise<NotificationKind[] | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .delete(unsubscribeTokens)
      .where(
        and(
          eq(unsubscribeTokens.tokenHash, hashToken(token)),
          gt(unsubscribeTokens.expiresAt, now),
        ),
      )
      .returning({ userId: unsubscribeTokens.userId, kinds: unsubscribeTokens.kinds });
    if (!row) return null;
    const kinds = JSON.parse(row.kinds) as NotificationKind[];
    for (const kind of kinds) await setSetting(tx, row.userId, kind, 'email', false);
    return kinds;
  });
}

/** How long a sent digest's record is kept: long past the day it guards. */
const DIGEST_KEEP_DAYS = 30;

/** Expired unsubscribe links, and digests long sent. Returns how many rows went. */
export async function pruneEmailRecords(db: Executor, now = new Date()): Promise<number> {
  const tokens = await db
    .delete(unsubscribeTokens)
    .where(lt(unsubscribeTokens.expiresAt, now))
    .returning({ hash: unsubscribeTokens.tokenHash });
  const digests = await db
    .delete(emailDigests)
    .where(lt(emailDigests.createdAt, new Date(now.getTime() - DIGEST_KEEP_DAYS * DAY_MS)))
    .returning({ userId: emailDigests.userId });
  return tokens.length + digests.length;
}
