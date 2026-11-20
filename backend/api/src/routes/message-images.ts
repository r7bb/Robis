import { randomUUID } from 'node:crypto';
import { type Database, messages, publishEvent, recordAudit } from '@robis/database';
import { contracts, isUuid } from '@robis/shared';
import type { MediaStorage } from '@robis/storage';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve, shape } from '../contract.ts';
import { ApiError } from '../errors.ts';
import {
  acceptImageBodies,
  admitImageUpload,
  assertRoomFor,
  IMAGE_CSP,
} from '../media/admit-upload.ts';
import { type ProcessedImage, toAttachment, UnreadableImageError } from '../media/images.ts';
import {
  auditActor,
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';
import { withIdempotency } from '../plugins/idempotency.ts';
import { rateLimit } from '../plugins/rate-limit.ts';
import { loadChannel, messageWire } from './channels.ts';

/** A burst of screenshots is normal; a sustained stream is not. */
const PICTURES_PER_MINUTE = 30;

/**
 * Pictures in chat (B2): a pasted screenshot or a photo, posted to a room as
 * its own message. The same path as an image on an issue: checked before
 * the body is read, re-encoded without metadata, within the workspace's
 * storage, through the idempotency ledger, and served to members only.
 * Unlike a text message, posting one is audited, as every upload is.
 */
export async function messageImageRoutes(
  app: FastifyInstance,
  opts: { db: Database; storage: MediaStorage },
) {
  const { db, storage } = opts;
  acceptImageBodies(app);
  const admitUpload = admitImageUpload(db);
  const pictureLimit = rateLimit({
    name: 'chat-picture',
    limit: PICTURES_PER_MINUTE,
    windowMs: 60_000,
  });

  async function processed(body: Uint8Array, declared: string): Promise<ProcessedImage> {
    try {
      return await toAttachment(body, declared);
    } catch (error) {
      if (error instanceof UnreadableImageError) {
        throw ApiError.badRequest(error.message, 'unreadable_image');
      }
      throw error;
    }
  }

  serve(
    app,
    contracts['messages.createImage'],
    {
      onRequest: [admitUpload, pictureLimit],
      preHandler: [requireAuth, requireMembership(db, 'message:create')],
    },
    async (request, { params: { channelId } }, reply) => {
      const user = currentUser(request);
      const { workspaceId } = currentMembership(request);
      await loadChannel(db, workspaceId, channelId);
      const body = request.body;
      if (!(body instanceof Uint8Array) || body.byteLength === 0) {
        throw new ApiError(415, 'unsupported_media_type', 'Upload a JPEG, PNG, WebP or AVIF image');
      }

      return withIdempotency(db, request, reply, 201, async () => {
        const image = await processed(body, request.headers['content-type'] ?? '');
        await assertRoomFor(db, workspaceId, image.bytes.byteLength);
        const key = `chat/${workspaceId}/${randomUUID()}.${image.extension}`;
        await storage.put(key, image.bytes, image.contentType);
        let created: typeof messages.$inferSelect;
        try {
          created = await db.transaction(async (tx) => {
            const [row] = await tx
              .insert(messages)
              .values({
                workspaceId,
                channelId,
                authorId: user.id,
                body: '',
                imageKey: key,
                imageContentType: image.contentType,
                imageBytes: image.bytes.byteLength,
                imageWidth: image.width,
                imageHeight: image.height,
              })
              .returning();
            await recordAudit(tx, auditActor(request), {
              workspaceId,
              entityType: 'message',
              entityId: row!.id,
              eventType: 'message.image_added',
              payload: { channelId, contentType: image.contentType, bytes: image.bytes.byteLength },
            });
            return row!;
          });
        } catch (error) {
          await storage.delete(key).catch(() => undefined);
          throw error;
        }
        try {
          await publishEvent(db, {
            type: 'message.created',
            workspaceId,
            channelId,
            messageId: created.id,
            actorId: user.id,
          });
        } catch (error) {
          app.log.warn({ err: error }, 'chat picture: not published');
        }
        return shape(contracts['messages.createImage'], {
          message: { ...messageWire(created), authorName: user.name },
        });
      });
    },
  );

  /** A message's picture, streamed, for members only: anyone else gets the same 404 as none. */
  app.get(
    '/workspaces/:workspaceId/messages/:messageId/image',
    { preHandler: [requireAuth, requireMembership(db, 'channel:read')] },
    async (request, reply) => {
      const { workspaceId } = currentMembership(request);
      const { messageId } = request.params as { messageId: string };
      if (!isUuid(messageId)) throw ApiError.notFound('Picture not found');
      const [row] = await db
        .select({ key: messages.imageKey, contentType: messages.imageContentType })
        .from(messages)
        .where(and(eq(messages.id, messageId), eq(messages.workspaceId, workspaceId)))
        .limit(1);
      const object = row?.key ? await storage.open(row.key) : null;
      if (!object || !row?.contentType) throw ApiError.notFound('Picture not found');
      return reply
        .header('content-type', row.contentType)
        .header('content-length', String(object.size))
        .header('content-disposition', `inline; filename="picture-${messageId}"`)
        .header('cache-control', 'private, max-age=300')
        .header('vary', 'Cookie')
        .header('x-content-type-options', 'nosniff')
        .header('cross-origin-resource-policy', 'same-site')
        .header('content-security-policy', IMAGE_CSP)
        .send(object.stream);
    },
  );
}
