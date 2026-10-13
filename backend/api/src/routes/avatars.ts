import { randomUUID } from 'node:crypto';
import { resolveSession, SESSION_COOKIE } from '@robis/auth';
import { type Database, users, workspaceMembers } from '@robis/database';
import { generatedAvatarSchema, isUuid } from '@robis/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError } from '../errors.ts';
import { avatarOf } from '../media/avatars.ts';
import {
  ACCEPTED_TYPES,
  MAX_UPLOAD_BYTES,
  toAvatar,
  UnreadableImageError,
} from '../media/images.ts';
import type { MediaStorage } from '../media/storage.ts';
import { currentUser, requireAuth } from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';
import { parse } from '../validate.ts';

/** Enough to try a few pictures, not enough to use the encoder as a free service. */
const UPLOADS_PER_MINUTE = 10;

/**
 * Profile pictures.
 *
 * Uploads arrive as the raw image body (`content-type: image/jpeg` and so
 * on) rather than multipart: one file, no form fields, no extra dependency.
 * The parser for image types is registered inside this plugin only, so no
 * other route accepts a binary body.
 */
export async function avatarRoutes(
  app: FastifyInstance,
  opts: { db: Database; storage: MediaStorage },
) {
  const { db, storage } = opts;

  app.addContentTypeParser(
    [...ACCEPTED_TYPES],
    { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES },
    (_request, body, done) => done(null, body),
  );

  const uploadLimit = rateLimit({
    name: 'avatar-upload',
    limit: UPLOADS_PER_MINUTE,
    windowMs: 60_000,
  });

  /**
   * Turn an upload away before its body is read.
   *
   * Fastify parses a body before any `preHandler` runs, so without this an
   * anonymous caller could make the server buffer the full upload limit
   * just to be told 401. The session is resolved here instead, and a
   * declared size over the limit is refused on the header alone.
   */
  async function admitUpload(request: FastifyRequest) {
    const declared = Number(request.headers['content-length'] ?? 0);
    if (declared > MAX_UPLOAD_BYTES) {
      throw new ApiError(413, 'payload_too_large', 'That picture is larger than 8 MB');
    }

    const token = request.cookies[SESSION_COOKIE];
    const user = token ? await resolveSession(db, token) : null;
    if (!user) throw ApiError.unauthorized();
    request.user = user;
  }

  /**
   * Swap the stored picture, then delete the file it replaced.
   *
   * The old value is read under a row lock inside the same transaction as
   * the write, so two uploads at once queue behind each other instead of
   * both replacing the same old picture and orphaning one of the new ones.
   */
  async function replace(userId: string, kind: 'photo' | 'generated', ref: string) {
    const { previous, row } = await db.transaction(async (tx) => {
      const [before] = await tx
        .select({ kind: users.avatarKind, ref: users.avatarRef })
        .from(users)
        .where(eq(users.id, userId))
        .for('update')
        .limit(1);

      if (!before) throw ApiError.unauthorized();

      const [after] = await tx
        .update(users)
        .set({ avatarKind: kind, avatarRef: ref, avatarUpdatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning({
          id: users.id,
          avatarKind: users.avatarKind,
          avatarRef: users.avatarRef,
          avatarUpdatedAt: users.avatarUpdatedAt,
        });

      return { previous: before, row: after! };
    });

    // After the row points at the new picture, and best-effort: the change
    // has already happened, so a failed delete is logged as an orphan to
    // sweep rather than reported to the person as a failure. A delete
    // removes the bytes, not just the reference.
    if (previous.kind === 'photo' && previous.ref && previous.ref !== ref) {
      try {
        await storage.delete(previous.ref);
      } catch (error) {
        app.log.warn({ err: error, key: previous.ref }, 'avatar: old picture not deleted');
      }
    }

    return avatarOf(row);
  }

  app.put(
    '/auth/me/avatar',
    { onRequest: admitUpload, preHandler: [requireAuth, uploadLimit] },
    async (request) => {
      const user = currentUser(request);
      const body = request.body;
      const declaredType = request.headers['content-type'] ?? '';

      if (!(body instanceof Uint8Array) || body.byteLength === 0) {
        throw new ApiError(415, 'unsupported_media_type', 'Upload a JPEG, PNG, WebP or AVIF image');
      }

      let image: Uint8Array;
      try {
        image = await toAvatar(body, declaredType);
      } catch (error) {
        if (error instanceof UnreadableImageError) {
          throw ApiError.badRequest(error.message, 'unreadable_image');
        }
        throw error;
      }

      // A fresh key per upload: the old file is deleted, never overwritten in
      // place, so a cached URL cannot serve the new picture under the old
      // version or the other way round.
      const key = `avatars/${randomUUID()}.webp`;
      await storage.put(key, image);

      try {
        return { avatar: await replace(user.id, 'photo', key) };
      } catch (error) {
        // The row never pointed at it, so nothing else will ever delete it.
        await storage.delete(key).catch(() => undefined);
        throw error;
      }
    },
  );

  app.put(
    '/auth/me/avatar/generated',
    { preHandler: [requireAuth, uploadLimit] },
    async (request) => {
      const user = currentUser(request);
      const { seed } = parse(generatedAvatarSchema, request.body);

      return { avatar: await replace(user.id, 'generated', seed) };
    },
  );

  /**
   * A person's photo, for people who share a workspace with them.
   *
   * Checked on every request, so a leaked link shows nothing to anyone
   * outside those workspaces, and a 404 rather than a 403 so it does not
   * confirm the account exists.
   */
  app.get('/users/:userId/avatar', { preHandler: requireAuth }, async (request, reply) => {
    const viewer = currentUser(request);
    const { userId } = request.params as { userId: string };

    if (!isUuid(userId)) throw ApiError.notFound('Not found');

    if (viewer.id !== userId) {
      const [shared] = await db
        .select({ one: sql`1` })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.userId, viewer.id),
            sql`${workspaceMembers.workspaceId} in (
              select workspace_id from workspace_members where user_id = ${userId}::uuid
            )`,
          ),
        )
        .limit(1);
      if (!shared) throw ApiError.notFound('Not found');
    }

    const [row] = await db
      .select({ kind: users.avatarKind, ref: users.avatarRef })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (row?.kind !== 'photo' || !row.ref) throw ApiError.notFound('Not found');

    const bytes = await storage.get(row.ref);
    if (!bytes) throw ApiError.notFound('Not found');

    return (
      reply
        .header('content-type', 'image/webp')
        // Private, short, and varying on the session: a shared cache must
        // never hand one member's view to another, and leaving a workspace
        // should stop showing the picture within minutes on a shared machine.
        .header('cache-control', 'private, max-age=300')
        .header('vary', 'Cookie')
        .header('x-content-type-options', 'nosniff')
        .header('cross-origin-resource-policy', 'same-site')
        .send(Buffer.from(bytes))
    );
  });
}
