import { randomUUID } from 'node:crypto';
import {
  attachments,
  auditEvents,
  type Database,
  enqueue,
  messages,
  publishEvent,
  recordAudit,
  STORAGE_PURGE_JOB,
  users,
  workspaceMembers,
  workspaces,
} from '@robis/database';
import { contracts, isUuid } from '@robis/shared';
import type { MediaStorage } from '@robis/storage';
import { and, desc, eq, isNotNull, like, notInArray, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import { acceptImageBodies, admitImageUpload, IMAGE_CSP } from '../media/admit-upload.ts';
import { avatarOf } from '../media/avatars.ts';
import { toCover, UnreadableImageError } from '../media/images.ts';
import {
  auditActor,
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';
import { PROFILE_ACTIVITY_HIDDEN, profileActivityPatterns } from '../profile-activity.ts';

/** Entries of recent activity a profile shows. */
const ACTIVITY_SHOWN = 30;
/** Images in a profile's grid. */
const SHARED_SHOWN = 24;
/** Cover changes a person may make in an hour. */
const COVERS_PER_HOUR = 20;
/** Profile edits and cover removals a person may make in an hour: each is a trail entry. */
const EDITS_PER_HOUR = 60;

/** What setting a cover (a key) or removing it (null) writes, and how the trail records it. */
function coverChange(key: string | null, bytes: number) {
  return key
    ? {
        columns: { coverKey: key, coverUpdatedAt: new Date() },
        audit: { eventType: 'member.cover_set', payload: { bytes } },
      }
    : {
        columns: { coverKey: null, coverUpdatedAt: null },
        audit: { eventType: 'member.cover_removed', payload: {} },
      };
}

/** A member as their profile shows them, or null when they are not one here. */
async function findPerson(db: Database, workspaceId: string, userId: string) {
  if (!isUuid(userId)) return null;
  const [row] = await db
    .select({
      userId: users.id,
      name: users.name,
      username: users.username,
      kind: users.kind,
      avatarKind: users.avatarKind,
      avatarRef: users.avatarRef,
      avatarUpdatedAt: users.avatarUpdatedAt,
      role: workspaceMembers.role,
      title: workspaceMembers.title,
      workingOn: workspaceMembers.workingOn,
      coverKey: workspaceMembers.coverKey,
      coverUpdatedAt: workspaceMembers.coverUpdatedAt,
      joinedAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  return row ?? null;
}

type Person = NonNullable<Awaited<ReturnType<typeof findPerson>>>;

/** The wire shape. The cover is a members-only route, versioned so a new one is fetched. */
function toWire(workspaceId: string, person: Person) {
  const version = person.coverUpdatedAt?.getTime() ?? 0;
  return {
    userId: person.userId,
    name: person.name,
    username: person.username,
    kind: person.kind,
    role: person.role,
    avatar: avatarOf({ id: person.userId, ...person }),
    title: person.title,
    workingOn: person.workingOn,
    cover: person.coverKey
      ? `/workspaces/${workspaceId}/people/${person.userId}/cover?v=${version}`
      : null,
    joinedAt: person.joinedAt,
  };
}

/**
 * Profiles (B2): a person as this workspace knows them. The membership check
 * runs on every route, so a non-member sees nothing, and someone who is not
 * a member here is the same 404 as an id that does not exist.
 */
export async function profileRoutes(
  app: FastifyInstance,
  opts: { db: Database; storage: MediaStorage },
) {
  const { db, storage } = opts;
  acceptImageBodies(app);
  const admitUpload = admitImageUpload(db);
  const editLimit = rateLimit({ name: 'profile-edit', limit: EDITS_PER_HOUR, windowMs: 3_600_000 });
  const coverLimit = rateLimit({
    name: 'profile-cover',
    limit: COVERS_PER_HOUR,
    windowMs: 3_600_000,
  });

  async function personOr404(workspaceId: string, userId: string) {
    const person = await findPerson(db, workspaceId, userId);
    if (!person) throw ApiError.notFound('Not a member of this workspace');
    return person;
  }

  /** Their recent work, only of the kinds the viewer's role may read. */
  async function activityOf(workspaceId: string, userId: string, patterns: string[]) {
    if (patterns.length === 0) return [];
    const rows = await db
      .select({
        id: auditEvents.id,
        actorId: auditEvents.actorId,
        actorKind: auditEvents.actorKind,
        actorName: users.name,
        entityType: auditEvents.entityType,
        entityId: auditEvents.entityId,
        eventType: auditEvents.eventType,
        payload: auditEvents.payload,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorId))
      .where(
        and(
          eq(auditEvents.workspaceId, workspaceId),
          eq(auditEvents.actorId, userId),
          or(...patterns.map((pattern) => like(auditEvents.eventType, pattern))),
          notInArray(auditEvents.eventType, [...PROFILE_ACTIVITY_HIDDEN]),
        ),
      )
      .orderBy(desc(auditEvents.seq))
      .limit(ACTIVITY_SHOWN);
    // The stored payload only: personal fields kept apart from the hash are
    // for the feed and the trail, and nothing shown here needs them.
    return rows.map((event) => ({ ...event, payload: JSON.parse(event.payload) }));
  }

  /** The images they added to issues here and the pictures they posted in chat, newest first. */
  async function sharedBy(workspaceId: string, userId: string) {
    const [onIssues, inChat] = await Promise.all([
      db
        .select()
        .from(attachments)
        .where(and(eq(attachments.workspaceId, workspaceId), eq(attachments.uploaderId, userId)))
        .orderBy(desc(attachments.createdAt))
        .limit(SHARED_SHOWN),
      db
        .select({
          id: messages.id,
          channelId: messages.channelId,
          width: messages.imageWidth,
          height: messages.imageHeight,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(
          and(
            eq(messages.workspaceId, workspaceId),
            eq(messages.authorId, userId),
            isNotNull(messages.imageKey),
            isNotNull(messages.imageWidth),
            isNotNull(messages.imageHeight),
          ),
        )
        .orderBy(desc(messages.createdAt))
        .limit(SHARED_SHOWN),
    ]);
    const images = [
      ...onIssues.map((row) => ({
        id: row.id,
        issueId: row.issueId,
        channelId: null,
        url: `/workspaces/${workspaceId}/attachments/${row.id}`,
        width: row.width,
        height: row.height,
        createdAt: row.createdAt,
      })),
      ...inChat.map((row) => ({
        id: row.id,
        issueId: null,
        channelId: row.channelId,
        url: `/workspaces/${workspaceId}/messages/${row.id}/image`,
        width: row.width!,
        height: row.height!,
        createdAt: row.createdAt,
      })),
    ];
    return images
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, SHARED_SHOWN);
  }

  async function storiesOn(workspaceId: string): Promise<boolean> {
    const [row] = await db
      .select({ on: workspaces.storiesEnabled })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    return row?.on ?? false;
  }

  /** Others' open views of this workspace re-read who is in it. Never fails the request. */
  async function notifyChanged(workspaceId: string, actorId: string) {
    try {
      await publishEvent(db, { type: 'member.changed', workspaceId, actorId });
    } catch (error) {
      app.log.warn({ err: error }, 'profile: change not published');
    }
  }

  serve(
    app,
    contracts['profiles.get'],
    { preHandler: [requireAuth, requireMembership(db, 'member:read')] },
    async (request, { params: { userId } }) => {
      const { workspaceId, role } = currentMembership(request);
      const person = await personOr404(workspaceId, userId);
      const patterns = profileActivityPatterns(role, await storiesOn(workspaceId));
      return {
        profile: toWire(workspaceId, person),
        activity: await activityOf(workspaceId, person.userId, patterns),
        shared: await sharedBy(workspaceId, person.userId),
      };
    },
  );

  serve(
    app,
    contracts['profiles.update'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read'), editLimit] },
    async (request, { body }) => {
      const { workspaceId } = currentMembership(request);
      const me = currentUser(request);
      const fields = {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.workingOn !== undefined ? { workingOn: body.workingOn } : {}),
      };
      await db.transaction(async (tx) => {
        await tx
          .update(workspaceMembers)
          .set(fields)
          .where(
            and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, me.id)),
          );
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'member',
          entityId: me.id,
          eventType: 'member.profile_updated',
          // Which fields, never their words: those are the person's own.
          payload: { fields: Object.keys(fields) },
        });
      });
      await notifyChanged(workspaceId, me.id);
      return { profile: toWire(workspaceId, await personOr404(workspaceId, me.id)) };
    },
  );

  serve(
    app,
    contracts['profiles.setCover'],
    {
      onRequest: [admitUpload, coverLimit],
      preHandler: [requireAuth, requireMembership(db, 'workspace:read')],
    },
    async (request) => {
      const { workspaceId } = currentMembership(request);
      const me = currentUser(request);
      const body = request.body;
      if (!(body instanceof Uint8Array) || body.byteLength === 0) {
        throw new ApiError(415, 'unsupported_media_type', 'Upload a JPEG, PNG, WebP or AVIF image');
      }
      let bytes: Uint8Array;
      try {
        bytes = await toCover(body, request.headers['content-type'] ?? '');
      } catch (error) {
        if (error instanceof UnreadableImageError) {
          throw ApiError.badRequest(error.message, 'unreadable_image');
        }
        throw error;
      }
      const key = `covers/${workspaceId}/${randomUUID()}.webp`;
      await storage.put(key, bytes, 'image/webp');
      try {
        await replaceCover(request, workspaceId, me.id, key, bytes.byteLength);
      } catch (error) {
        await storage.delete(key).catch(() => undefined);
        throw error;
      }
      await notifyChanged(workspaceId, me.id);
      return { profile: toWire(workspaceId, await personOr404(workspaceId, me.id)) };
    },
  );

  /**
   * Point the membership at its new cover, under a lock so two at once
   * cannot both keep theirs, and queue the old file for removal in the same
   * transaction. Audited without the picture.
   */
  async function replaceCover(
    request: Parameters<typeof auditActor>[0],
    workspaceId: string,
    userId: string,
    key: string | null,
    bytes: number,
  ): Promise<boolean> {
    const mine = and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    );
    return db.transaction(async (tx) => {
      const [current] = await tx
        .select({ key: workspaceMembers.coverKey })
        .from(workspaceMembers)
        .where(mine)
        .for('update');
      if (!current) throw ApiError.notFound('Not a member of this workspace');
      // Removing a cover there is not: nothing to change, nothing to record.
      if (!current.key && !key) return false;
      if (current.key) await enqueue(tx, STORAGE_PURGE_JOB, { keys: [current.key] });
      const change = coverChange(key, bytes);
      await tx.update(workspaceMembers).set(change.columns).where(mine);
      await recordAudit(tx, auditActor(request), {
        workspaceId,
        entityType: 'member',
        entityId: userId,
        ...change.audit,
      });
      return true;
    });
  }

  serve(
    app,
    contracts['profiles.removeCover'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read'), editLimit] },
    async (request) => {
      const { workspaceId } = currentMembership(request);
      const me = currentUser(request);
      if (await replaceCover(request, workspaceId, me.id, null, 0)) {
        await notifyChanged(workspaceId, me.id);
      }
      return undefined;
    },
  );

  /** A cover, streamed, to members only; anyone else gets the same 404 as no cover. */
  app.get(
    '/workspaces/:workspaceId/people/:userId/cover',
    { preHandler: [requireAuth, requireMembership(db, 'member:read')] },
    async (request, reply) => {
      const { workspaceId } = currentMembership(request);
      const { userId } = request.params as { userId: string };
      const person = await personOr404(workspaceId, userId);
      const object = person.coverKey ? await storage.open(person.coverKey) : null;
      if (!object) throw ApiError.notFound('No cover');
      return (
        reply
          .header('content-type', 'image/webp')
          .header('content-length', String(object.size))
          .header('content-disposition', `inline; filename="cover-${person.userId}.webp"`)
          // The URL carries a version, so a new cover is a new URL. Short and
          // private, so one taken down, or a member gone, stops showing soon.
          .header('cache-control', 'private, max-age=300')
          .header('vary', 'Cookie')
          .header('x-content-type-options', 'nosniff')
          .header('cross-origin-resource-policy', 'same-site')
          .header('content-security-policy', IMAGE_CSP)
          .send(object.stream)
      );
    },
  );
}
