import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_KINDS,
  type NotificationChannel,
  type NotificationKind,
} from '@robis/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Executor } from './index.ts';
import { notificationSettings, notifications } from './schema.ts';

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

  const made = await db
    .insert(notifications)
    .values(
      wanted.map((item) => ({
        ...item,
        payload: JSON.stringify(item.payload),
        inApp: channels.get(item.userId)?.in_app ?? true,
      })),
    )
    // Idempotency: a redelivered job must not notify twice. The unique index
    // on (user_id, dedupe_key) is what makes this a no-op.
    .onConflictDoNothing({ target: [notifications.userId, notifications.dedupeKey] })
    .returning({ id: notifications.id, userId: notifications.userId });

  return made.map((row) => ({ ...row, channels: channels.get(row.userId) ?? { ...ALL_ON } }));
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
