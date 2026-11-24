import { randomUUID } from 'node:crypto';
import {
  channels,
  type Database,
  enqueue,
  issues,
  messages,
  notifications,
  PUSH_NOTIFICATION_JOB,
  type PushJob,
  projects,
  pushSubscriptions,
  spaceThreads,
} from '@robis/database';
import { contracts, isWithinSnooze, type REMINDER_SUBJECTS } from '@robis/shared';
import { and, count, eq, gt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import {
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';

type Subject = (typeof REMINDER_SUBJECTS)[number];

/** Reminders set in an hour, and waiting at once, per person. */
const REMINDERS_PER_HOUR = 30;
const REMINDERS_WAITING_MAX = 200;
const HOUR_MS = 3_600_000;
/** How much of a message a reminder quotes. */
const EXCERPT_LENGTH = 140;

/** What a reminder says about its subject, read now; null when it is not here. */
async function aboutIssue(db: Database, workspaceId: string, id: string) {
  const [row] = await db
    .select({
      title: issues.title,
      key: sql<string>`${projects.key} || '-' || ${issues.number}`,
    })
    .from(issues)
    .innerJoin(projects, eq(projects.id, issues.projectId))
    .where(and(eq(issues.id, id), eq(issues.workspaceId, workspaceId)));
  return row ? { issueId: id, issueKey: row.key, issueTitle: row.title } : null;
}

async function aboutMessage(db: Database, workspaceId: string, id: string) {
  const [row] = await db
    .select({ body: messages.body, channelId: messages.channelId, room: channels.name })
    .from(messages)
    .innerJoin(channels, eq(channels.id, messages.channelId))
    .where(and(eq(messages.id, id), eq(messages.workspaceId, workspaceId)));
  if (!row) return null;
  return {
    channelId: row.channelId,
    messageId: id,
    title: `#${row.room}`,
    excerpt: row.body.slice(0, EXCERPT_LENGTH),
  };
}

async function aboutThread(db: Database, workspaceId: string, id: string) {
  const [row] = await db
    .select({ title: spaceThreads.title })
    .from(spaceThreads)
    .where(and(eq(spaceThreads.id, id), eq(spaceThreads.workspaceId, workspaceId)));
  return row ? { threadId: id, title: row.title } : null;
}

const ABOUT: Record<
  Subject,
  (db: Database, workspaceId: string, id: string) => Promise<Record<string, string> | null>
> = { issue: aboutIssue, message: aboutMessage, thread: aboutThread };

/**
 * Remind me. A reminder is a notification to yourself that waits snoozed
 * until its time, so the inbox's Later, Bring back and Dismiss all apply
 * to it unchanged; where a device takes pushes, one is queued for then.
 * Every member may read issues, chat and spaces, so membership is the check.
 */
export async function reminderRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;
  const limit = rateLimit({ name: 'reminders', limit: REMINDERS_PER_HOUR, windowMs: HOUR_MS });

  async function waitingFor(userId: string) {
    const [row] = await db
      .select({ n: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.kind, 'reminder'),
          gt(notifications.snoozedUntil, sql`now()`),
        ),
      );
    return row?.n ?? 0;
  }

  async function takesPushes(userId: string) {
    const [row] = await db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .limit(1);
    return Boolean(row);
  }

  serve(
    app,
    contracts['reminders.create'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read'), limit] },
    async (request, { body: { about, id, at } }) => {
      const { workspaceId } = currentMembership(request);
      const user = currentUser(request);
      if (!isWithinSnooze(at)) {
        throw ApiError.badRequest('Pick a time ahead, within 90 days', 'bad_time');
      }
      const payload = await ABOUT[about](db, workspaceId, id);
      if (!payload) throw ApiError.notFound('Nothing to be reminded of here');
      if ((await waitingFor(user.id)) >= REMINDERS_WAITING_MAX) {
        throw ApiError.conflict('That is a lot of reminders. Clear some first.', 'too_many');
      }
      const pushes = await takesPushes(user.id);

      const reminder = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(notifications)
          .values({
            userId: user.id,
            workspaceId,
            actorId: null,
            kind: 'reminder',
            entityType: about,
            entityId: id,
            dedupeKey: `reminder:${randomUUID()}`,
            payload: JSON.stringify(payload),
            snoozedUntil: at,
          })
          .returning({ id: notifications.id, at: notifications.snoozedUntil });
        if (pushes) {
          const job: PushJob = { notificationId: row!.id };
          await enqueue(tx, PUSH_NOTIFICATION_JOB, job, { delayMs: at.getTime() - Date.now() });
        }
        return row!;
      });
      return { reminder: { id: reminder.id, at: reminder.at! } };
    },
  );
}
