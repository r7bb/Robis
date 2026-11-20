import { randomUUID } from 'node:crypto';
import {
  type Database,
  findMembership,
  publishEvent,
  queueStoryPurge,
  recordAudit,
  STORY_TTL_MS,
  stories,
  workspaces,
} from '@robis/database';
import { can, contracts, isUuid, MAX_LIVE_STORIES, type STORY_TONES } from '@robis/shared';
import type { MediaStorage } from '@robis/storage';
import { and, asc, count, eq, gt, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
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

/** Stories a person may post in an hour, photos and text together. */
const STORIES_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;

type StoryRow = typeof stories.$inferSelect;

/** The wire shape. The URL is an API route, never a storage location. */
function toWire(row: StoryRow) {
  return {
    id: row.id,
    authorId: row.authorId,
    kind: row.kind,
    body: row.body,
    tone: row.tone as (typeof STORY_TONES)[number] | null,
    url: row.storageKey ? `/workspaces/${row.workspaceId}/stories/${row.id}/image` : null,
    width: row.width,
    height: row.height,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

/** Still within its 24 hours: checked on every read, so expiry needs no job to be true. */
const live = () => gt(stories.expiresAt, sql`now()`);

/**
 * Stories (B2): a photo or a few words, seen by the workspace for 24 hours.
 *
 * Every route answers a non-member with 404, like the rest of a workspace.
 * A story past its 24 hours is a 404 everywhere at once, before the job
 * that deletes it has run; with stories turned off, every route but the
 * owner's switch is refused with 409 `stories_off`, and the image with 404.
 * Posting and taking down are audited without the story's words.
 */
export async function storyRoutes(
  app: FastifyInstance,
  opts: { db: Database; storage: MediaStorage },
) {
  const { db, storage } = opts;

  acceptImageBodies(app);
  const admitUpload = admitImageUpload(db);
  const postLimit = rateLimit({ name: 'story-post', limit: STORIES_PER_HOUR, windowMs: HOUR_MS });

  async function storiesEnabled(workspaceId: string): Promise<boolean> {
    const [row] = await db
      .select({ enabled: workspaces.storiesEnabled })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    return row?.enabled ?? false;
  }

  async function assertStoriesOn(workspaceId: string) {
    if (!(await storiesEnabled(workspaceId))) {
      throw ApiError.conflict('Stories are turned off in this workspace.', 'stories_off');
    }
  }

  async function liveStory(workspaceId: string, storyId: string) {
    if (!isUuid(storyId)) throw ApiError.notFound('Story not found');
    const [row] = await db
      .select()
      .from(stories)
      .where(and(eq(stories.id, storyId), eq(stories.workspaceId, workspaceId), live()))
      .limit(1);
    if (!row) throw ApiError.notFound('Story not found');
    return row;
  }

  /** How many stories a person has showing in a workspace now. */
  async function showingCount(tx: Pick<Database, 'select'>, workspaceId: string, userId: string) {
    const [showing] = await tx
      .select({ n: count() })
      .from(stories)
      .where(and(eq(stories.workspaceId, workspaceId), eq(stories.authorId, userId), live()));
    return showing?.n ?? 0;
  }

  function tooMany() {
    return ApiError.conflict(
      `You have ${MAX_LIVE_STORIES} stories showing. Take one down, or wait for one to go.`,
      'too_many_stories',
    );
  }

  /**
   * Before a photo's body is read, for a member only (anyone else falls
   * through to the membership check's 404): refuse with stories off or the
   * cap reached, so neither costs a decode and a write. `post` checks the
   * cap again under its lock; this is only the cheap early answer.
   */
  async function admitStory(request: FastifyRequest) {
    const { workspaceId } = request.params as { workspaceId?: string };
    const user = request.user;
    if (!user || !workspaceId || !isUuid(workspaceId)) return;
    if (!(await findMembership(db, workspaceId, user.id))) return;
    await assertStoriesOn(workspaceId);
    if ((await showingCount(db, workspaceId, user.id)) >= MAX_LIVE_STORIES) throw tooMany();
  }

  /** Bars re-read the list. Never fails the request. */
  async function notifyChanged(workspaceId: string, storyId: string | null, actorId: string) {
    try {
      await publishEvent(db, { type: 'story.changed', workspaceId, storyId, actorId });
    } catch (error) {
      app.log.warn({ err: error }, 'story: change not published');
    }
  }

  /**
   * Insert a story and audit it, one at a time per person and workspace, so
   * two posts at once cannot both slip under the cap.
   */
  async function post(
    request: Parameters<typeof auditActor>[0],
    values: Omit<typeof stories.$inferInsert, 'workspaceId' | 'authorId' | 'expiresAt'>,
  ): Promise<StoryRow> {
    const user = currentUser(request);
    const { workspaceId } = currentMembership(request);
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`story:${workspaceId}:${user.id}`}))`,
      );
      if ((await showingCount(tx, workspaceId, user.id)) >= MAX_LIVE_STORIES) throw tooMany();
      const [created] = await tx
        .insert(stories)
        .values({
          ...values,
          workspaceId,
          authorId: user.id,
          expiresAt: sql`now() + ${`${STORY_TTL_MS} milliseconds`}::interval`,
        })
        .returning();
      await recordAudit(tx, auditActor(request), {
        workspaceId,
        entityType: 'story',
        entityId: created!.id,
        eventType: 'story.added',
        // What and how big, never the words: those are the author's, and
        // the trail outlives the story.
        payload: { kind: created!.kind, bytes: created!.bytes },
      });
      return created!;
    });
  }

  serve(
    app,
    contracts['stories.list'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read')] },
    async (request) => {
      const { workspaceId } = currentMembership(request);
      await assertStoriesOn(workspaceId);
      const rows = await db
        .select()
        .from(stories)
        .where(and(eq(stories.workspaceId, workspaceId), live()))
        .orderBy(asc(stories.createdAt));
      return { stories: rows.map(toWire) };
    },
  );

  serve(
    app,
    contracts['stories.createText'],
    { preHandler: [requireAuth, requireMembership(db, 'story:create'), postLimit] },
    async (request, { body: input }, reply) => {
      const { workspaceId } = currentMembership(request);
      await assertStoriesOn(workspaceId);
      return withIdempotency(db, request, reply, 201, async () => {
        const row = await post(request, { kind: 'text', body: input.body, tone: input.tone });
        await notifyChanged(workspaceId, row.id, currentUser(request).id);
        return shape(contracts['stories.createText'], { story: toWire(row) });
      });
    },
  );

  serve(
    app,
    contracts['stories.createPhoto'],
    {
      onRequest: [admitUpload, admitStory, postLimit],
      preHandler: [requireAuth, requireMembership(db, 'story:create')],
    },
    async (request, _input, reply) => {
      const { workspaceId } = currentMembership(request);
      await assertStoriesOn(workspaceId);
      const body = request.body;
      if (!(body instanceof Uint8Array) || body.byteLength === 0) {
        throw new ApiError(415, 'unsupported_media_type', 'Upload a JPEG, PNG, WebP or AVIF image');
      }

      // Replayed from a phone that was offline, the ledger hands back the
      // first story instead of storing the photo twice.
      return withIdempotency(db, request, reply, 201, async () => {
        let image: ProcessedImage;
        try {
          image = await toAttachment(body, request.headers['content-type'] ?? '');
        } catch (error) {
          if (error instanceof UnreadableImageError) {
            throw ApiError.badRequest(error.message, 'unreadable_image');
          }
          throw error;
        }

        await assertRoomFor(db, workspaceId, image.bytes.byteLength);
        const key = `stories/${workspaceId}/${randomUUID()}.${image.extension}`;
        await storage.put(key, image.bytes, image.contentType);
        let row: StoryRow;
        try {
          row = await post(request, {
            kind: 'photo',
            storageKey: key,
            contentType: image.contentType,
            bytes: image.bytes.byteLength,
            width: image.width,
            height: image.height,
          });
        } catch (error) {
          // No row points at it, so nothing else would ever delete it.
          await storage.delete(key).catch(() => undefined);
          throw error;
        }
        await notifyChanged(workspaceId, row.id, currentUser(request).id);
        return shape(contracts['stories.createPhoto'], { story: toWire(row) });
      });
    },
  );

  /**
   * A photo story's image, streamed, for members only, while it lasts.
   * Past its 24 hours, or with stories off, it is the same 404 a missing
   * id gets, even if the file is still waiting to be removed.
   */
  app.get(
    '/workspaces/:workspaceId/stories/:storyId/image',
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read')] },
    async (request, reply) => {
      const { workspaceId } = currentMembership(request);
      const { storyId } = request.params as { storyId: string };
      if (!(await storiesEnabled(workspaceId))) throw ApiError.notFound('Story not found');
      const row = await liveStory(workspaceId, storyId);
      if (!row.storageKey || !row.contentType) throw ApiError.notFound('Story not found');

      // The id never changes what it shows, so it is the tag; but every view
      // asks again, so a story taken down or hidden stops showing at once.
      const etag = `"${row.id}"`;
      if (request.headers['if-none-match'] === etag) {
        return reply
          .header('etag', etag)
          .header('cache-control', 'private, no-cache')
          .code(304)
          .send();
      }
      const object = await storage.open(row.storageKey);
      if (!object) throw ApiError.notFound('Story not found');
      return reply
        .header('content-type', row.contentType)
        .header('content-length', String(object.size))
        .header(
          'content-disposition',
          `inline; filename="story-${row.id}.${row.contentType.slice(6)}"`,
        )
        .header('cache-control', 'private, no-cache')
        .header('etag', etag)
        .header('vary', 'Cookie')
        .header('x-content-type-options', 'nosniff')
        .header('cross-origin-resource-policy', 'same-site')
        .header('content-security-policy', IMAGE_CSP)
        .send(object.stream);
    },
  );

  serve(
    app,
    contracts['stories.delete'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read')] },
    async (request, { params: { storyId } }) => {
      const user = currentUser(request);
      const { workspaceId, role } = currentMembership(request);
      // Allowed with stories off too: taking one down never has to wait.
      const row = await liveStory(workspaceId, storyId);

      const own = row.authorId === user.id;
      if (!can(role, own ? 'story:delete_own' : 'story:delete_any')) throw ApiError.forbidden();

      await db.transaction(async (tx) => {
        // Queued with the delete, so the file goes even if storage is down now.
        await queueStoryPurge(tx, eq(stories.id, row.id));
        const deleted = await tx
          .delete(stories)
          .where(eq(stories.id, row.id))
          .returning({ id: stories.id });
        if (deleted.length === 0) throw ApiError.notFound('Story not found');
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'story',
          entityId: row.id,
          eventType: 'story.deleted',
          payload: { kind: row.kind, moderated: !own },
        });
      });
      await notifyChanged(workspaceId, row.id, user.id);
      return undefined;
    },
  );

  /*
   * The owner's switch. Off hides every story there is and refuses new
   * ones; they are not deleted, and go at their 24 hours as usual, so
   * turning it back on within the day shows what was there.
   */
  serve(
    app,
    contracts['workspaces.setStoriesEnabled'],
    { preHandler: [requireAuth, requireMembership(db, 'story:configure')] },
    async (request, { body: { enabled } }) => {
      const { workspaceId } = currentMembership(request);
      await db.transaction(async (tx) => {
        const [row] = await tx
          .update(workspaces)
          .set({ storiesEnabled: enabled, updatedAt: new Date() })
          .where(eq(workspaces.id, workspaceId))
          .returning({ id: workspaces.id });
        if (!row) throw ApiError.notFound('Workspace not found');
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'workspace',
          entityId: workspaceId,
          eventType: 'workspace.stories_enabled',
          payload: { enabled },
        });
      });
      await notifyChanged(workspaceId, null, currentUser(request).id);
      return { storiesEnabled: enabled };
    },
  );
}
