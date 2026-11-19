import {
  channelsFor,
  claimDigest,
  type DigestMailPayload,
  type Executor,
  heldByTwoFactor,
  issueUnsubscribeToken,
  MAIL_DIGEST_JOB,
  MAIL_NOTIFICATION_JOB,
  markDigestSent,
  markEmailed,
  type NotificationMailPayload,
  notifications,
  users,
} from '@robis/database';
import {
  digestMail,
  linkFor,
  type Mailer,
  mentionMail,
  type NotificationLine,
} from '@robis/mailer';
import type { NotificationKind } from '@robis/shared';
import { eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Handlers } from './runner.ts';

/**
 * Notifications by email (C3). Both jobs read the person's settings again
 * when they send, so email turned off after a notification was made stops
 * it too, and they mail only an address the person confirmed.
 *
 * Mark after send, as account mail does: if the server takes a message and
 * the reply is lost, the retry sends it again. Marking first would lose the
 * email instead, which is the worse failure for something asked for.
 */

const actors = alias(users, 'actors');

type Row = {
  id: string;
  userId: string;
  kind: string;
  workspaceId: string | null;
  payload: string;
  actor: string | null;
};

async function rowsOf(db: Executor, ids: readonly string[]): Promise<Row[]> {
  if (ids.length === 0) return [];
  return db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      kind: notifications.kind,
      workspaceId: notifications.workspaceId,
      payload: notifications.payload,
      actor: actors.name,
    })
    .from(notifications)
    .leftJoin(actors, eq(actors.id, notifications.actorId))
    .where(inArray(notifications.id, [...ids]));
}

/** Where a notification leads, from the web origin and its own ids. */
function linkOf(webOrigin: string, row: Row, payload: Record<string, unknown>): string {
  if (row.workspaceId && typeof payload.issueId === 'string') {
    return `${webOrigin}/workspaces/${row.workspaceId}/issues/${payload.issueId}`;
  }
  if (row.kind === 'nudge' && typeof payload.nudge === 'string') {
    return `${webOrigin}/guide/${payload.nudge}`;
  }
  return row.workspaceId ? `${webOrigin}/workspaces/${row.workspaceId}` : `${webOrigin}/workspaces`;
}

function lineOf(webOrigin: string, row: Row): NotificationLine {
  const payload = JSON.parse(row.payload) as Record<string, unknown>;
  const text = (key: string) =>
    typeof payload[key] === 'string' ? (payload[key] as string) : undefined;
  return {
    kind: row.kind,
    actor: row.actor,
    issueKey: text('issueKey') ?? null,
    issueTitle: text('issueTitle') ?? null,
    excerpt: text('excerpt'),
    title: text('title'),
    body: text('body'),
    change: text('change'),
    link: linkOf(webOrigin, row, payload),
  };
}

/**
 * The address to mail, if the person confirmed it. Mail for an address not
 * confirmed is passed over, not kept for later: by the time it is, the news
 * is in the app, and a pile of old mail arriving at once helps nobody.
 */
async function confirmedAddress(db: Executor, userId: string): Promise<string | null> {
  const [user] = await db
    .select({ email: users.email, verifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user?.verifiedAt ? user.email : null;
}

/** Of these rows, those whose kind is still on by email for their person: one lookup a kind. */
async function stillWanted(db: Executor, userId: string, rows: readonly Row[]): Promise<Row[]> {
  const on = new Map<string, boolean>();
  for (const kind of new Set(rows.map((r) => r.kind))) {
    const channels = await channelsFor(db, [userId], kind as NotificationKind);
    on.set(kind, channels.get(userId)?.email ?? false);
  }
  const wanted = rows.filter((row) => on.get(row.kind));
  // None from a workspace that requires two-factor while they have none (C4).
  const held = new Map<string, boolean>();
  for (const id of new Set(wanted.flatMap((row) => (row.workspaceId ? [row.workspaceId] : [])))) {
    held.set(id, await heldByTwoFactor(db, userId, id));
  }
  return wanted.filter((row) => !(row.workspaceId && held.get(row.workspaceId)));
}

export function notificationMailHandlers(deps: { mailer: Mailer; webOrigin: string }): Handlers {
  const { mailer, webOrigin } = deps;
  const settings = `${webOrigin}/account`;

  return {
    [MAIL_NOTIFICATION_JOB]: async (payload, { db }) => {
      const { notificationId } = payload as NotificationMailPayload;
      const [row] = await rowsOf(db, [notificationId]);
      // Dismissed, or its person gone: nothing to send, now or on a retry.
      if (!row) return;
      const [done] = await db
        .select({ at: notifications.emailedAt })
        .from(notifications)
        .where(eq(notifications.id, row.id));
      if (done?.at) return;

      const to = await confirmedAddress(db, row.userId);
      const [wanted] = to ? await stillWanted(db, row.userId, [row]) : [];
      if (!to || !wanted) return markEmailed(db, [row.id]);

      const token = await issueUnsubscribeToken(db, row.userId, [row.kind as NotificationKind]);
      const { kind: _kind, ...line } = lineOf(webOrigin, row);
      await mailer.send(
        mentionMail(to, line, { unsubscribe: linkFor(webOrigin, '/unsubscribe', token), settings }),
      );
      await markEmailed(db, [row.id]);
    },

    [MAIL_DIGEST_JOB]: async (payload, { db }) => {
      const { userId, day } = payload as DigestMailPayload;
      const digest = await claimDigest(db, userId, day);
      // Sent already: a retry after the send, or a second job for the day.
      if (!digest) return;

      const to = await confirmedAddress(db, userId);
      const rows = to
        ? await stillWanted(db, userId, await rowsOf(db, digest.notificationIds))
        : [];
      if (!to || rows.length === 0) return markDigestSent(db, userId, day, digest.notificationIds);

      const kinds = [...new Set(rows.map((r) => r.kind as NotificationKind))];
      const token = await issueUnsubscribeToken(db, userId, kinds);
      await mailer.send(
        digestMail(
          to,
          rows.map((row) => lineOf(webOrigin, row)),
          { unsubscribe: linkFor(webOrigin, '/unsubscribe', token), settings },
        ),
      );
      await markDigestSent(db, userId, day, digest.notificationIds);
    },
  };
}
