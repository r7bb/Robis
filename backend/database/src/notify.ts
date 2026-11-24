import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_KINDS,
  type NotificationChannel,
  type NotificationKind,
} from '@robis/shared';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Executor } from './index.ts';
import { queueNotificationMail } from './mail-jobs.ts';
import { withTwoFactor } from './queries.ts';
import { enqueue } from './queue.ts';
import { notificationSettings, notifications, pushSubscriptions, workspaces } from './schema.ts';

/**
 * Telling people things (C3), through one door. Every kind of notification
 * is made here, so each person's settings are read in one place: a kind off
 * in every channel makes nothing at all, and one off in the app only is
 * kept (for the channels still on) but never listed in the inbox.
 */

export type Channels = Record<NotificationChannel, boolean>;

const ALL_ON: Channels = { in_app: true, email: true, push: true };

/** A kind the settings cover; anything else (an invitation) is always shown. */
function isSetting(kind: string): kind is NotificationKind {
  return (NOTIFICATION_KINDS as readonly string[]).includes(kind);
}

/** Each person's channels for one kind: on unless they turned it off. */
export async function channelsFor(
  db: Executor,
  userIds: readonly string[],
  kind: NotificationKind,
): Promise<Map<string, Channels>> {
  const result = new Map(userIds.map((id) => [id, { ...ALL_ON }]));
  if (userIds.length === 0) return result;
  const rows = await db
    .select({
      userId: notificationSettings.userId,
      channel: notificationSettings.channel,
      enabled: notificationSettings.enabled,
    })
    .from(notificationSettings)
    .where(
      and(inArray(notificationSettings.userId, [...userIds]), eq(notificationSettings.kind, kind)),
    );
  for (const row of rows) {
    const channels = result.get(row.userId);
    if (channels) channels[row.channel as NotificationChannel] = row.enabled;
  }
  return result;
}

/** One person's settings, every kind, in a fixed order. */
export async function settingsOf(db: Executor, userId: string) {
  const rows = await db
    .select({
      kind: notificationSettings.kind,
      channel: notificationSettings.channel,
      enabled: notificationSettings.enabled,
    })
    .from(notificationSettings)
    .where(eq(notificationSettings.userId, userId));
  return NOTIFICATION_KINDS.map((kind) => {
    const channels: Channels = { ...ALL_ON };
    for (const row of rows) {
      if (row.kind === kind) channels[row.channel as NotificationChannel] = row.enabled;
    }
    return { kind, channels };
  });
}

/** Turn one kind on or off in one channel. */
export async function setSetting(
  db: Executor,
  userId: string,
  kind: NotificationKind,
  channel: NotificationChannel,
  enabled: boolean,
) {
  await db
    .insert(notificationSettings)
    .values({ userId, kind, channel, enabled })
    .onConflictDoUpdate({
      target: [
        notificationSettings.userId,
        notificationSettings.kind,
        notificationSettings.channel,
      ],
      set: { enabled, updatedAt: new Date() },
    });
}

/**
 * When a notification goes by email (C3): a mention at once, anything else
 * in the day's digest, nothing for a kind off by email or outside the
 * settings (an invitation has its own mail).
 */
function emailDueFor(
  kind: string,
  channels: Channels | undefined,
  mentionsMailedThisHour: number,
): 'now' | 'digest' | null {
  if (!isSetting(kind) || !channels?.email) return null;
  return kind === 'mention' && mentionsMailedThisHour < MENTION_EMAILS_PER_HOUR ? 'now' : 'digest';
}

/**
 * Mentions mailed at once to one person in an hour (C3); past this, the
 * rest wait for the digest, so a busy thread, or someone mentioning another
 * over and over, cannot fill their inbox.
 */
export const MENTION_EMAILS_PER_HOUR = 10;
const HOUR_MS = 60 * 60_000;

/** How many mentions each of these people was mailed at once in the last hour. */
async function mentionsMailedRecently(db: Executor, userIds: readonly string[]) {
  const rows = await db
    .select({ userId: notifications.userId, count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        inArray(notifications.userId, [...userIds]),
        eq(notifications.kind, 'mention'),
        eq(notifications.emailDue, 'now'),
        gt(notifications.createdAt, new Date(Date.now() - HOUR_MS)),
      ),
    )
    .groupBy(notifications.userId);
  return new Map(rows.map((row) => [row.userId, row.count]));
}

/** Push one notification to its person's devices (C3). The job names the row only. */
export const PUSH_NOTIFICATION_JOB = 'push.notification';
export type PushJob = { notificationId: string };

/** Of these people, those with a device that takes pushes. */
async function withDevices(db: Executor, userIds: readonly string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ userId: pushSubscriptions.userId })
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, [...userIds]));
  return new Set(rows.map((row) => row.userId));
}

/**
 * Of these notices, those for someone a workspace requiring two-factor
 * (C4) would refuse. Mail and pushes say what a notice says, so none is
 * sent for these; the row is kept, and listed once they turn it on.
 */
async function heldBack(
  db: Executor,
  items: readonly NotificationInput[],
): Promise<Set<NotificationInput>> {
  const ids = [...new Set(items.flatMap((item) => (item.workspaceId ? [item.workspaceId] : [])))];
  if (ids.length === 0) return new Set();
  const requiring = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(inArray(workspaces.id, ids), eq(workspaces.requireTwoFactor, true)));
  if (requiring.length === 0) return new Set();
  const strict = new Set(requiring.map((row) => row.id));
  const asked = items.filter((item) => item.workspaceId && strict.has(item.workspaceId));
  const on = await withTwoFactor(
    db,
    asked.map((item) => item.userId),
  );
  return new Set(asked.filter((item) => !on.has(item.userId)));
}

export type NotificationInput = {
  userId: string;
  workspaceId: string | null;
  actorId: string | null;
  kind: string;
  entityType: string;
  entityId: string | null;
  /** "Never twice": the same key for the same person makes one row, ever. */
  dedupeKey: string;
  payload: Record<string, unknown>;
};

/**
 * Make the notifications that the recipients' settings allow, each at most
 * once (the dedupe key). Returns the ids of the rows made, with their
 * channels, for whatever sends them on.
 */
export async function notify(
  db: Executor,
  items: readonly NotificationInput[],
): Promise<{ id: string; userId: string; channels: Channels }[]> {
  if (items.length === 0) return [];
  const kind = items[0]!.kind;
  if (items.some((item) => item.kind !== kind)) throw new Error('notify: one kind at a time');

  const channels = isSetting(kind)
    ? await channelsFor(
        db,
        items.map((i) => i.userId),
        kind,
      )
    : new Map(items.map((i) => [i.userId, { ...ALL_ON }]));
  const wanted = items.filter((item) =>
    NOTIFICATION_CHANNELS.some((channel) => channels.get(item.userId)?.[channel]),
  );
  if (wanted.length === 0) return [];

  // The rows and the mail that sends a mention commit together: a retried
  // job finds its rows made and queues nothing twice, and a mail job is
  // never lost between the two.
  const recent =
    kind === 'mention'
      ? await mentionsMailedRecently(
          db,
          wanted.map((w) => w.userId),
        )
      : new Map<string, number>();
  const held = await heldBack(db, wanted);
  const subscribed = await withDevices(
    db,
    wanted.filter((w) => channels.get(w.userId)?.push && !held.has(w)).map((w) => w.userId),
  );
  return db.transaction(async (tx) => {
    const made = await tx
      .insert(notifications)
      .values(
        wanted.map((item) => ({
          ...item,
          payload: JSON.stringify(item.payload),
          inApp: channels.get(item.userId)?.in_app ?? true,
          emailDue: held.has(item)
            ? null
            : emailDueFor(kind, channels.get(item.userId), recent.get(item.userId) ?? 0),
        })),
      )
      // Idempotency: a redelivered job must not notify twice. The unique index
      // on (user_id, dedupe_key) is what makes this a no-op.
      .onConflictDoNothing({ target: [notifications.userId, notifications.dedupeKey] })
      .returning({
        id: notifications.id,
        userId: notifications.userId,
        emailDue: notifications.emailDue,
      });
    for (const row of made) {
      if (row.emailDue === 'now') await queueNotificationMail(tx, row.id);
      if (subscribed.has(row.userId)) {
        const job: PushJob = { notificationId: row.id };
        await enqueue(tx, PUSH_NOTIFICATION_JOB, job);
      }
    }
    return made.map((row) => ({
      id: row.id,
      userId: row.userId,
      channels: channels.get(row.userId) ?? { ...ALL_ON },
    }));
  });
}

/**
 * How long repeats of one change are one notification (C3): an issue handed
 * back and forth, or a meeting moved again and again, tells people once in
 * each window rather than once per edit.
 */
export const NOTICE_WINDOW_MS = 10 * 60_000;

/** Which notice window a moment falls in, for an event id. */
export function noticeWindow(now = Date.now()): number {
  return Math.floor(now / NOTICE_WINDOW_MS);
}

/** Someone was given an issue by someone else (C3). Queued with the change. */
export const NOTIFY_ASSIGNMENT_JOB = 'notify.assignment';
export type AssignmentJob = {
  issueId: string;
  assigneeId: string;
  actorId: string | null;
  /**
   * The issue, the assignee and the notice window: a redelivered job, or the
   * same person given it again soon after, is one notification; given it
   * again later, another.
   */
  eventId: string;
};

/** A meeting was moved, changed or called off (C3). Queued with the change. */
export const NOTIFY_MEETING_JOB = 'notify.meeting';
export type MeetingChange = 'moved' | 'changed' | 'canceled';
export type MeetingJob = {
  meetingId: string;
  change: MeetingChange;
  actorId: string | null;
  /** The meeting, the kind of change and the notice window (or once, for a cancellation). */
  eventId: string;
};

/**
 * Something happened in a space that someone should hear of (C3): a reply
 * (its thread's author and the reply it answers hear) or a reply marked as
 * the answer (its author hears). Queued with the change; the job names the
 * reply only, and the worker reads the rest.
 */
export const NOTIFY_SPACE_JOB = 'notify.space';
export type SpaceEvent = 'reply' | 'answer';
export type SpaceJob = { replyId: string; event: SpaceEvent; actorId: string };
