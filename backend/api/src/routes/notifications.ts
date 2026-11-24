import { type Database, notifications, outsideTwoFactorWorkspaces, users } from '@robis/database';
import { contracts, isUuid, isWithinSnooze } from '@robis/shared';
import { and, desc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import { currentUser, requireAuth, requirePicture } from '../plugins/authz.ts';

/**
 * The signed-in user's inbox.
 *
 * These routes are scoped by recipient rather than by workspace, because an
 * inbox spans every workspace you belong to. That makes `userId` the tenant
 * boundary here: every query filters on it, and there is no path that takes a
 * notification id without also constraining the owner.
 */
/** Whether a snooze still has time to run. */
function isWaiting(snoozedUntil: Date | null): boolean {
  return snoozedUntil !== null && snoozedUntil.getTime() > Date.now();
}

/** Not waiting under Later: never snoozed, or its time has come. */
const notWaiting = () =>
  or(isNull(notifications.snoozedUntil), lte(notifications.snoozedUntil, sql`now()`));

/** Newest first, one back from a snooze counted from when it came back. */
const shownAt = sql`greatest(${notifications.createdAt}, coalesce(${notifications.snoozedUntil}, ${notifications.createdAt}))`;

export async function notificationRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  serve(
    app,
    contracts['notifications.list'],
    { preHandler: [requireAuth, requirePicture] },
    async (request, { query: { unread } }) => {
      const user = currentUser(request);

      // Not the ones whose kind is off in the app (C3): those exist only for
      // the email or push still on.
      const filters = [eq(notifications.userId, user.id), eq(notifications.inApp, true)];
      if (unread === '1' || unread === 'true') {
        filters.push(isNull(notifications.readAt), notWaiting()!);
      }
      // Nothing from a workspace that requires two-factor until they have it (C4).
      if (!user.hasTwoFactor)
        filters.push(outsideTwoFactorWorkspaces(db, notifications.workspaceId));

      const rows = await db
        .select({
          id: notifications.id,
          kind: notifications.kind,
          workspaceId: notifications.workspaceId,
          entityType: notifications.entityType,
          entityId: notifications.entityId,
          payload: notifications.payload,
          readAt: notifications.readAt,
          snoozedUntil: notifications.snoozedUntil,
          createdAt: notifications.createdAt,
          actorId: notifications.actorId,
          actorName: users.name,
        })
        .from(notifications)
        .leftJoin(users, eq(users.id, notifications.actorId))
        .where(and(...filters))
        .orderBy(desc(shownAt))
        .limit(100);

      const items = rows.map((row) => ({ ...row, payload: JSON.parse(row.payload) }));

      return {
        notifications: items,
        // What waits under Later is not news yet.
        unreadCount: items.filter((item) => item.readAt === null && !isWaiting(item.snoozedUntil))
          .length,
      };
    },
  );

  serve(
    app,
    contracts['notifications.read'],
    { preHandler: [requireAuth, requirePicture] },
    async (request, { params: { notificationId } }) => {
      const user = currentUser(request);

      if (!isUuid(notificationId)) throw ApiError.notFound('Notification not found');

      const [updated] = await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          // Owner is part of the predicate, not a separate check: there is no
          // way to reach someone else's notification even with its id.
          and(eq(notifications.id, notificationId), eq(notifications.userId, user.id)),
        )
        .returning({ id: notifications.id, readAt: notifications.readAt });

      if (!updated) throw ApiError.notFound('Notification not found');

      return { notification: updated };
    },
  );

  serve(
    app,
    contracts['notifications.delete'],
    { preHandler: [requireAuth, requirePicture] },
    async (request, { params: { notificationId } }) => {
      const user = currentUser(request);

      if (!isUuid(notificationId)) throw ApiError.notFound('Notification not found');

      /*
       * Dismissing is a real delete rather than a `dismissedAt` flag.
       *
       * The dedupe key is what stops the worker re-sending the same nudge, and
       * it is enforced by a unique index on `(user_id, dedupe_key)`. Keeping
       * dismissed rows would mean that index also permanently suppresses the
       * notification -- dismiss a weekly nudge once and it never returns.
       * Deleting the row frees the key, so next week's scan can raise it again.
       */
      const [deleted] = await db
        .delete(notifications)
        .where(and(eq(notifications.id, notificationId), eq(notifications.userId, user.id)))
        .returning({ id: notifications.id });

      if (!deleted) throw ApiError.notFound('Notification not found');

      return undefined;
    },
  );

  serve(
    app,
    contracts['notifications.snooze'],
    { preHandler: [requireAuth, requirePicture] },
    async (request, { params: { notificationId }, body: { until } }) => {
      const user = currentUser(request);
      if (!isUuid(notificationId)) throw ApiError.notFound('Notification not found');
      if (until && !isWithinSnooze(until)) {
        throw ApiError.badRequest('Pick a time ahead, within 90 days', 'bad_time');
      }

      // Snoozed, it comes back unread; brought back early, it stays as it was.
      const [updated] = await db
        .update(notifications)
        .set(until ? { snoozedUntil: until, readAt: null } : { snoozedUntil: null })
        .where(and(eq(notifications.id, notificationId), eq(notifications.userId, user.id)))
        .returning({
          id: notifications.id,
          readAt: notifications.readAt,
          snoozedUntil: notifications.snoozedUntil,
        });
      if (!updated) throw ApiError.notFound('Notification not found');
      return { notification: updated };
    },
  );

  serve(
    app,
    contracts['notifications.readAll'],
    { preHandler: [requireAuth, requirePicture] },
    async (request) => {
      const user = currentUser(request);

      const updated = await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.userId, user.id),
            eq(notifications.inApp, true),
            isNull(notifications.readAt),
            // Not what waits under Later: it comes back unread, as asked.
            notWaiting(),
            // Only those they can see (C4): the hidden wait, unread.
            user.hasTwoFactor
              ? undefined
              : outsideTwoFactorWorkspaces(db, notifications.workspaceId),
          ),
        )
        .returning({ id: notifications.id });

      return { marked: updated.length };
    },
  );
}
