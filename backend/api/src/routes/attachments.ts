import { randomUUID } from 'node:crypto';
import { resolveSession } from '@robis/auth';
import {
  attachments,
  comments,
  type Database,
  findMembership,
  issues,
  publishEvent,
  queueAttachmentPurge,
  recordAudit,
  WORKSPACE_STORAGE_QUOTA_BYTES,
  workspaceStorageUsed,
} from '@robis/database';
import { can, isUuid } from '@robis/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError } from '../errors.ts';
import {
  ACCEPTED_TYPES,
  MAX_UPLOAD_BYTES,
  toAttachment,
  UnreadableImageError,
} from '../media/images.ts';
import type { MediaStorage } from '../media/storage.ts';
import {
  auditActor,
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
  sessionToken,
} from '../plugins/authz.ts';
import { withIdempotency } from '../plugins/idempotency.ts';
import { rateLimit } from '../plugins/rate-limit.ts';

/** A burst of screenshots is normal; a sustained stream is not. */
const UPLOADS_PER_MINUTE = 30;

type AttachmentRow = typeof attachments.$inferSelect;

/** The wire shape. The URL is an API route, never a storage location. */
function toWire(row: AttachmentRow) {
  return {
    id: row.id,
    issueId: row.issueId,
    commentId: row.commentId,
    uploaderId: row.uploaderId,
    contentType: row.contentType,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    createdAt: row.createdAt,
    url: `/workspaces/${row.workspaceId}/attachments/${row.id}`,
  };
}

/**
 * Images on issues and comments.
 *
 * Uploads are the raw image body, like profile pictures, through a parser
 * scoped to this plugin. Each one can carry an `Idempotency-Key`: an image
 * attached with no network is queued on the device and replayed on
 * reconnect, and the ledger (which fingerprints the bytes) makes the replay
 * return the first upload instead of storing a second copy.
 */
export async function attachmentRoutes(
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
    name: 'attachment-upload',
    limit: UPLOADS_PER_MINUTE,
    windowMs: 60_000,
  });

  /** Refuse before the body is read: see the note in `avatars.ts`. */
  async function admitUpload(request: FastifyRequest) {
    if (Number(request.headers['content-length'] ?? 0) > MAX_UPLOAD_BYTES) {
      throw new ApiError(413, 'payload_too_large', 'That image is larger than 8 MB');
    }
    const token = sessionToken(request);
    const user = token ? await resolveSession(db, token) : null;
    if (!user) throw ApiError.unauthorized();
    request.user = user;

    // The quota (stage 1, item 11), before the body is read, and only for
    // a member: anyone else falls through to the membership check's 404,
    // so a full workspace never confirms it exists.
    const { workspaceId } = request.params as { workspaceId?: string };
    if (!workspaceId || !isUuid(workspaceId)) return;
    if (!(await findMembership(db, workspaceId, user.id))) return;
    const incoming = Number(request.headers['content-length'] ?? 0);
    const used = await workspaceStorageUsed(db, workspaceId);
    if (used + incoming > WORKSPACE_STORAGE_QUOTA_BYTES) {
      throw new ApiError(
        413,
        'storage_quota_exceeded',
        'This workspace is out of storage. An owner can make room by deleting old images.',
      );
    }
  }

  /** Tell open issue pages to re-read their images. Never fails the request. */
  async function notifyChanged(workspaceId: string, issueId: string, actorId: string) {
    try {
      await publishEvent(db, { type: 'attachment.changed', workspaceId, issueId, actorId });
    } catch (error) {
      app.log.warn({ err: error }, 'attachment: change not published');
    }
  }

  /** The issue, if it is in this workspace; 404 otherwise, never 403. */
  async function issueIn(workspaceId: string, issueId: string) {
    if (!isUuid(issueId)) throw ApiError.notFound('Issue not found');
    const [issue] = await db
      .select({ id: issues.id, projectId: issues.projectId })
      .from(issues)
      .where(and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)))
      .limit(1);
    if (!issue) throw ApiError.notFound('Issue not found');
    return issue;
  }

  async function attachmentIn(workspaceId: string, attachmentId: string) {
    if (!isUuid(attachmentId)) throw ApiError.notFound('Attachment not found');
    const [row] = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, attachmentId), eq(attachments.workspaceId, workspaceId)))
      .limit(1);
    if (!row) throw ApiError.notFound('Attachment not found');
    return row;
  }

  app.post(
    '/workspaces/:workspaceId/issues/:issueId/attachments',
    {
      onRequest: admitUpload,
      preHandler: [requireAuth, requireMembership(db, 'attachment:create'), uploadLimit],
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { workspaceId } = currentMembership(request);
      const { issueId } = request.params as { issueId: string };
      const { commentId } = request.query as { commentId?: string };
      const body = request.body;

      const issue = await issueIn(workspaceId, issueId);

      // A comment's attachment belongs to that comment's author: nobody can
      // add pictures to words someone else wrote.
      if (commentId !== undefined) {
        if (!isUuid(commentId)) throw ApiError.notFound('Comment not found');
        const [comment] = await db
          .select({ authorId: comments.authorId })
          .from(comments)
          .where(and(eq(comments.id, commentId), eq(comments.issueId, issueId)))
          .limit(1);
        if (!comment) throw ApiError.notFound('Comment not found');
        if (comment.authorId !== user.id) throw ApiError.forbidden();
      }

      if (!(body instanceof Uint8Array) || body.byteLength === 0) {
        throw new ApiError(415, 'unsupported_media_type', 'Upload a JPEG, PNG, WebP or AVIF image');
      }

      return withIdempotency(db, request, reply, 201, async () => {
        let image: Awaited<ReturnType<typeof toAttachment>>;
        try {
          image = await toAttachment(body, request.headers['content-type'] ?? '');
        } catch (error) {
          if (error instanceof UnreadableImageError) {
            throw ApiError.badRequest(error.message, 'unreadable_image');
          }
          throw error;
        }

        const key = `attachments/${workspaceId}/${randomUUID()}.${image.extension}`;
        await storage.put(key, image.bytes, image.contentType);

        let row: AttachmentRow;
        try {
          row = await db.transaction(async (tx) => {
            const [created] = await tx
              .insert(attachments)
              .values({
                workspaceId,
                issueId,
                commentId: commentId ?? null,
                uploaderId: user.id,
                storageKey: key,
                contentType: image.contentType,
                bytes: image.bytes.byteLength,
                width: image.width,
                height: image.height,
              })
              .returning();

            await recordAudit(tx, auditActor(request), {
              workspaceId,
              entityType: 'attachment',
              entityId: created!.id,
              eventType: 'attachment.added',
              payload: {
                issueId,
                commentId: commentId ?? null,
                contentType: image.contentType,
                bytes: image.bytes.byteLength,
              },
            });

            return created!;
          });
        } catch (error) {
          // The row never pointed at it, so nothing else would ever delete it.
          await storage.delete(key).catch(() => undefined);
          throw error;
        }

        // After the commit, and best-effort: the image exists now, and a
        // failed notification must not undo it or turn it into an error.
        await notifyChanged(workspaceId, issue.id, user.id);

        return { attachment: toWire(row) };
      });
    },
  );

  app.get(
    '/workspaces/:workspaceId/issues/:issueId/attachments',
    { preHandler: [requireAuth, requireMembership(db, 'issue:read')] },
    async (request) => {
      const { workspaceId } = currentMembership(request);
      const { issueId } = request.params as { issueId: string };
      await issueIn(workspaceId, issueId);

      const rows = await db
        .select()
        .from(attachments)
        .where(and(eq(attachments.issueId, issueId), eq(attachments.workspaceId, workspaceId)))
        .orderBy(asc(attachments.createdAt));

      return { attachments: rows.map(toWire) };
    },
  );

  /**
   * The image itself, streamed, for members only.
   *
   * The membership check runs on every request, so a copied link shows
   * nothing outside the workspace, and the answer to a non-member is the
   * same 404 a missing id gets.
   */
  app.get(
    '/workspaces/:workspaceId/attachments/:attachmentId',
    { preHandler: [requireAuth, requireMembership(db, 'issue:read')] },
    async (request, reply) => {
      const { workspaceId } = currentMembership(request);
      const { attachmentId } = request.params as { attachmentId: string };
      const row = await attachmentIn(workspaceId, attachmentId);

      const object = await storage.open(row.storageKey);
      if (!object) throw ApiError.notFound('Attachment not found');

      return reply
        .header('content-type', row.contentType)
        .header('content-length', String(object.size))
        .header('content-disposition', `inline; filename="attachment-${row.id}"`)
        .header('cache-control', 'private, max-age=300')
        .header('vary', 'Cookie')
        .header('x-content-type-options', 'nosniff')
        .header('cross-origin-resource-policy', 'same-site')
        .send(object.stream);
    },
  );

  app.delete(
    '/workspaces/:workspaceId/attachments/:attachmentId',
    { preHandler: [requireAuth, requireMembership(db, 'issue:read')] },
    async (request, reply) => {
      const user = currentUser(request);
      const { workspaceId, role } = currentMembership(request);
      const { attachmentId } = request.params as { attachmentId: string };
      const row = await attachmentIn(workspaceId, attachmentId);

      const own = row.uploaderId === user.id;
      const allowed = own ? can(role, 'attachment:delete_own') : can(role, 'attachment:delete_any');
      if (!allowed) throw ApiError.forbidden();

      await db.transaction(async (tx) => {
        // Queued with the delete, so the file goes even if storage is down
        // right now: the job retries, where an inline delete would only log.
        await queueAttachmentPurge(tx, eq(attachments.id, row.id));

        const deleted = await tx
          .delete(attachments)
          .where(eq(attachments.id, row.id))
          .returning({ id: attachments.id });
        if (deleted.length === 0) throw ApiError.notFound('Attachment not found');

        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'attachment',
          entityId: row.id,
          eventType: 'attachment.deleted',
          payload: { issueId: row.issueId, commentId: row.commentId, moderated: !own },
        });
      });

      await notifyChanged(workspaceId, row.issueId, user.id);

      return reply.status(204).send();
    },
  );
}
