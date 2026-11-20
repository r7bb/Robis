import { randomUUID } from 'node:crypto';
import {
  type Database,
  postComments,
  postReactions,
  posts,
  publishEvent,
  queuePostPhotoPurge,
  recordAudit,
  workspaceMembers,
} from '@robis/database';
import { can, contracts, isUuid, WORKING_ON_MAX_LENGTH } from '@robis/shared';
import type { MediaStorage } from '@robis/storage';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { serve, shape } from '../contract.ts';
import { ApiError } from '../errors.ts';
import { postIn, postWire } from '../feed/post-wire.ts';
import {
  acceptImageBodies,
  admitImageUpload,
  assertRoomFor,
  IMAGE_CSP,
} from '../media/admit-upload.ts';
import {
  MEME_CAPTION_MAX_LENGTH,
  type ProcessedImage,
  toAttachment,
  toMeme,
  UnreadableImageError,
} from '../media/images.ts';
import {
  auditActor,
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';
import { withIdempotency } from '../plugins/idempotency.ts';
import { rateLimit } from '../plugins/rate-limit.ts';

/**
 * A meme caption to draw on a photo post (Phase 2c), from the
 * `X-Robis-Meme-Caption` header, URI-encoded: a header rather than the
 * address, so the words are not written into access logs. Null for none.
 */
function memeCaption(raw: string | string[] | undefined): string | null {
  if (typeof raw !== 'string' || raw === '') return null;
  let caption: string;
  try {
    caption = decodeURIComponent(raw).replace(/\s+/g, ' ').trim();
  } catch {
    throw ApiError.badRequest('That meme caption could not be read', 'bad_meme_caption');
  }
  if (caption.length === 0 || caption.length > MEME_CAPTION_MAX_LENGTH) {
    throw ApiError.badRequest(
      `A meme caption is one line of up to ${MEME_CAPTION_MAX_LENGTH} characters`,
      'bad_meme_caption',
    );
  }
  return caption;
}

/** Posts and comments a person may write in an hour. */
const WRITES_PER_HOUR = 60;
/** Reactions a person may give or take back in an hour: each tells every open feed. */
const REACTIONS_PER_HOUR = 300;
const HOUR_MS = 3_600_000;

/**
 * Feed posts (Phase 2c): words or a photo, comments, and three reactions.
 * Every route answers a non-member with 404. Posting, editing and taking
 * down are audited (photos as every upload is), without the words; a
 * reaction is not, as a chat message is not: it is its own record.
 */
export async function postRoutes(
  app: FastifyInstance,
  opts: { db: Database; storage: MediaStorage },
) {
  const { db, storage } = opts;
  acceptImageBodies(app);
  const admitUpload = admitImageUpload(db);
  const writeLimit = rateLimit({ name: 'feed-write', limit: WRITES_PER_HOUR, windowMs: HOUR_MS });
  const reactLimit = rateLimit({
    name: 'feed-react',
    limit: REACTIONS_PER_HOUR,
    windowMs: HOUR_MS,
  });

  /** Open feeds re-read. Never fails the request. */
  async function notifyChanged(workspaceId: string, postId: string, actorId: string) {
    try {
      await publishEvent(db, { type: 'feed.changed', workspaceId, postId, actorId });
    } catch (error) {
      app.log.warn({ err: error }, 'feed: change not published');
    }
  }

  /** Insert a post and audit it in one transaction. */
  async function createPost(
    request: FastifyRequest,
    values: Omit<typeof posts.$inferInsert, 'workspaceId' | 'authorId'>,
  ) {
    const { workspaceId } = currentMembership(request);
    const user = currentUser(request);
    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(posts)
        .values({ ...values, workspaceId, authorId: user.id })
        .returning();
      await recordAudit(tx, auditActor(request), {
        workspaceId,
        entityType: 'post',
        entityId: created!.id,
        eventType: 'post.created',
        payload: { kind: created!.kind, bytes: created!.photoBytes },
      });
      return created!;
    });
    await notifyChanged(workspaceId, row.id, user.id);
    return row;
  }

  serve(
    app,
    contracts['posts.create'],
    { preHandler: [requireAuth, requireMembership(db, 'post:create'), writeLimit] },
    async (request, { body: input }, reply) =>
      withIdempotency(db, request, reply, 201, async () => {
        const row = await createPost(request, { kind: 'text', body: input.body });
        return shape(contracts['posts.create'], { post: await postWire(db, row) });
      }),
  );

  /*
   * The weekly check-in (Phase 2c): what you are working on, as a post the
   * team sees, and as your profile's Working on line here (its first line,
   * cut to fit). Optional: nothing reminds anyone who has not answered.
   */
  serve(
    app,
    contracts['posts.checkIn'],
    { preHandler: [requireAuth, requireMembership(db, 'post:create'), writeLimit] },
    async (request, { body: input }, reply) =>
      withIdempotency(db, request, reply, 201, async () => {
        const { workspaceId } = currentMembership(request);
        const user = currentUser(request);
        const row = await createPost(request, { kind: 'checkin', body: input.body });
        const line = input.body.split('\n')[0]!.trim().slice(0, WORKING_ON_MAX_LENGTH);
        await db
          .update(workspaceMembers)
          .set({ workingOn: line })
          .where(
            and(
              eq(workspaceMembers.workspaceId, workspaceId),
              eq(workspaceMembers.userId, user.id),
            ),
          );
        return shape(contracts['posts.checkIn'], { post: await postWire(db, row) });
      }),
  );

  async function processed(
    body: Uint8Array,
    declared: string,
    caption: string | null,
  ): Promise<ProcessedImage> {
    try {
      return caption ? await toMeme(body, declared, caption) : await toAttachment(body, declared);
    } catch (error) {
      if (error instanceof UnreadableImageError) {
        throw ApiError.badRequest(error.message, 'unreadable_image');
      }
      throw error;
    }
  }

  serve(
    app,
    contracts['posts.createPhoto'],
    {
      onRequest: [admitUpload, writeLimit],
      preHandler: [requireAuth, requireMembership(db, 'post:create')],
    },
    async (request, _input, reply) => {
      const { workspaceId } = currentMembership(request);
      const body = request.body;
      if (!(body instanceof Uint8Array) || body.byteLength === 0) {
        throw new ApiError(415, 'unsupported_media_type', 'Upload a JPEG, PNG, WebP or AVIF image');
      }
      const caption = memeCaption(request.headers['x-robis-meme-caption']);
      return withIdempotency(db, request, reply, 201, async () => {
        const image = await processed(body, request.headers['content-type'] ?? '', caption);
        await assertRoomFor(db, workspaceId, image.bytes.byteLength);
        const key = `posts/${workspaceId}/${randomUUID()}.${image.extension}`;
        await storage.put(key, image.bytes, image.contentType);
        try {
          const row = await createPost(request, {
            kind: 'photo',
            photoKey: key,
            photoContentType: image.contentType,
            photoBytes: image.bytes.byteLength,
            photoWidth: image.width,
            photoHeight: image.height,
          });
          return shape(contracts['posts.createPhoto'], { post: await postWire(db, row) });
        } catch (error) {
          await storage.delete(key).catch(() => undefined);
          throw error;
        }
      });
    },
  );

  serve(
    app,
    contracts['posts.update'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read'), writeLimit] },
    async (request, { params: { postId }, body: input }) => {
      const { workspaceId } = currentMembership(request);
      const user = currentUser(request);
      const row = await postIn(db, workspaceId, postId);
      if (row.authorId !== user.id) throw ApiError.forbidden('Only its author can change a post');
      if (row.kind !== 'photo' && input.body === '') {
        throw ApiError.badRequest('A post needs words; take it down instead', 'empty_post');
      }
      const updated = await db.transaction(async (tx) => {
        const [changed] = await tx
          .update(posts)
          // A first caption on a photo is not an edit; changing words is.
          .set({ body: input.body, editedAt: row.body === '' ? row.editedAt : new Date() })
          .where(eq(posts.id, row.id))
          .returning();
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'post',
          entityId: row.id,
          eventType: 'post.updated',
          payload: { kind: row.kind },
        });
        return changed!;
      });
      await notifyChanged(workspaceId, row.id, user.id);
      return { post: await postWire(db, updated) };
    },
  );

  serve(
    app,
    contracts['posts.delete'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read')] },
    async (request, { params: { postId } }) => {
      const { workspaceId, role } = currentMembership(request);
      const user = currentUser(request);
      const row = await postIn(db, workspaceId, postId);
      const own = row.authorId === user.id;
      if (!can(role, own ? 'post:delete_own' : 'post:delete_any')) throw ApiError.forbidden();
      await db.transaction(async (tx) => {
        await queuePostPhotoPurge(tx, eq(posts.id, row.id));
        const gone = await tx.delete(posts).where(eq(posts.id, row.id)).returning({ id: posts.id });
        if (gone.length === 0) throw ApiError.notFound('Post not found');
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'post',
          entityId: row.id,
          eventType: 'post.deleted',
          payload: { kind: row.kind, moderated: !own },
        });
      });
      await notifyChanged(workspaceId, row.id, user.id);
      return undefined;
    },
  );

  /** A post's photo, streamed, for members only. */
  app.get(
    '/workspaces/:workspaceId/posts/:postId/photo',
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read')] },
    async (request, reply) => {
      const { workspaceId } = currentMembership(request);
      const { postId } = request.params as { postId: string };
      const row = await postIn(db, workspaceId, postId);
      const object = row.photoKey ? await storage.open(row.photoKey) : null;
      if (!object || !row.photoContentType) throw ApiError.notFound('Photo not found');
      return reply
        .header('content-type', row.photoContentType)
        .header('content-length', String(object.size))
        .header('content-disposition', `inline; filename="post-${row.id}"`)
        .header('cache-control', 'private, max-age=300')
        .header('vary', 'Cookie')
        .header('x-content-type-options', 'nosniff')
        .header('cross-origin-resource-policy', 'same-site')
        .header('content-security-policy', IMAGE_CSP)
        .send(object.stream);
    },
  );

  serve(
    app,
    contracts['posts.comments'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read')] },
    async (request, { params: { postId } }) => {
      const { workspaceId } = currentMembership(request);
      const row = await postIn(db, workspaceId, postId);
      const comments = await db
        .select({
          id: postComments.id,
          postId: postComments.postId,
          authorId: postComments.authorId,
          body: postComments.body,
          createdAt: postComments.createdAt,
        })
        .from(postComments)
        .where(eq(postComments.postId, row.id))
        .orderBy(asc(postComments.createdAt));
      return { comments };
    },
  );

  serve(
    app,
    contracts['posts.comment'],
    { preHandler: [requireAuth, requireMembership(db, 'post:comment'), writeLimit] },
    async (request, { params: { postId }, body: input }, reply) => {
      const { workspaceId } = currentMembership(request);
      const user = currentUser(request);
      const row = await postIn(db, workspaceId, postId);
      return withIdempotency(db, request, reply, 201, async () => {
        const comment = await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(postComments)
            .values({ postId: row.id, workspaceId, authorId: user.id, body: input.body })
            .returning();
          await recordAudit(tx, auditActor(request), {
            workspaceId,
            entityType: 'post_comment',
            entityId: created!.id,
            eventType: 'post.commented',
            payload: { postId: row.id },
          });
          return created!;
        });
        await notifyChanged(workspaceId, row.id, user.id);
        return shape(contracts['posts.comment'], {
          comment: {
            id: comment.id,
            postId: comment.postId,
            authorId: comment.authorId,
            body: comment.body,
            createdAt: comment.createdAt,
          },
        });
      });
    },
  );

  serve(
    app,
    contracts['posts.deleteComment'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read')] },
    async (request, { params: { commentId } }) => {
      const { workspaceId, role } = currentMembership(request);
      const user = currentUser(request);
      if (!isUuid(commentId)) throw ApiError.notFound('Comment not found');
      const [comment] = await db
        .select()
        .from(postComments)
        .where(and(eq(postComments.id, commentId), eq(postComments.workspaceId, workspaceId)))
        .limit(1);
      if (!comment) throw ApiError.notFound('Comment not found');
      const own = comment.authorId === user.id;
      if (!can(role, own ? 'post:delete_own' : 'post:delete_any')) throw ApiError.forbidden();
      await db.transaction(async (tx) => {
        await tx.delete(postComments).where(eq(postComments.id, comment.id));
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'post_comment',
          entityId: comment.id,
          eventType: 'post.comment_deleted',
          payload: { postId: comment.postId, moderated: !own },
        });
      });
      await notifyChanged(workspaceId, comment.postId, user.id);
      return undefined;
    },
  );

  serve(
    app,
    contracts['posts.react'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read'), reactLimit] },
    async (request, { params: { postId, reaction } }) => {
      const { workspaceId } = currentMembership(request);
      const user = currentUser(request);
      const row = await postIn(db, workspaceId, postId);
      // Doing it twice is the same as once: the row is the reaction.
      const added = await db
        .insert(postReactions)
        .values({ postId: row.id, userId: user.id, reaction })
        .onConflictDoNothing()
        .returning({ postId: postReactions.postId });
      // Already so: nothing changed, so nobody is told.
      if (added.length > 0) await notifyChanged(workspaceId, row.id, user.id);
      return undefined;
    },
  );

  serve(
    app,
    contracts['posts.unreact'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read'), reactLimit] },
    async (request, { params: { postId, reaction } }) => {
      const { workspaceId } = currentMembership(request);
      const user = currentUser(request);
      const row = await postIn(db, workspaceId, postId);
      const taken = await db
        .delete(postReactions)
        .where(
          and(
            eq(postReactions.postId, row.id),
            eq(postReactions.userId, user.id),
            eq(postReactions.reaction, reaction),
          ),
        )
        .returning({ postId: postReactions.postId });
      if (taken.length > 0) await notifyChanged(workspaceId, row.id, user.id);
      return undefined;
    },
  );
}
