import {
  type Database,
  recordAudit,
  spaceReplies,
  spaceReplyReactions,
  spaces,
  spaceThreadReactions,
  spaceThreads,
} from '@robis/database';
import {
  can,
  contracts,
  type PostReaction,
  SPACE_REPLIES_SHOWN_MAX,
  SPACE_REPLY_DEPTH_MAX,
} from '@robis/shared';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import {
  auditActor,
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';
import {
  type ReplyRow,
  replyIn,
  replyReactions,
  replyWire,
  threadIn,
  threadSummaries,
} from './wire.ts';

/** Reactions a person may give or take back in an hour, as on the feed. */
const REACTIONS_PER_HOUR = 300;
const HOUR_MS = 3_600_000;

type Notify = (request: FastifyRequest, spaceId: string, threadId: string | null) => Promise<void>;

/** Where a new reply sits: under its parent, or beside it once replies are nested deep enough. */
export function placeReply(parent: Pick<ReplyRow, 'id' | 'parentId' | 'depth'> | null) {
  if (!parent) return { parentId: null, depth: 0 };
  if (parent.depth >= SPACE_REPLY_DEPTH_MAX)
    return { parentId: parent.parentId, depth: parent.depth };
  return { parentId: parent.id, depth: parent.depth + 1 };
}

/**
 * A thread and its replies: reading one, replying, taking a reply down,
 * marking the answer, and reactions on a thread or a reply.
 */
export async function spaceReplyRoutes(
  app: FastifyInstance,
  opts: { db: Database; notify: Notify; writeLimit: preHandlerHookHandler },
) {
  const { db, notify, writeLimit } = opts;
  const reactLimit = rateLimit({
    name: 'space-react',
    limit: REACTIONS_PER_HOUR,
    windowMs: HOUR_MS,
  });

  serve(
    app,
    contracts['spaces.thread'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read')] },
    async (request, { params: { threadId } }) => {
      const { workspaceId } = currentMembership(request);
      const thread = await threadIn(db, workspaceId, threadId);
      const [rows, [space], [summary]] = await Promise.all([
        db
          .select()
          .from(spaceReplies)
          .where(eq(spaceReplies.threadId, thread.id))
          .orderBy(asc(spaceReplies.createdAt), asc(spaceReplies.id))
          .limit(SPACE_REPLIES_SHOWN_MAX + 1),
        db.select({ name: spaces.name }).from(spaces).where(eq(spaces.id, thread.spaceId)),
        threadSummaries(db, [thread]),
      ]);
      const shown = rows.slice(0, SPACE_REPLIES_SHOWN_MAX);
      const reactions = await replyReactions(
        db,
        shown.map((row) => row.id),
      );
      const { excerpt: _excerpt, ...rest } = summary!;
      return {
        thread: {
          ...rest,
          body: thread.body,
          solvedReplyId: thread.solvedReplyId,
          spaceName: space?.name ?? '',
        },
        replies: shown.map((row) => replyWire(row, reactions.get(row.id)!)),
        truncated: rows.length > SPACE_REPLIES_SHOWN_MAX,
      };
    },
  );

  serve(
    app,
    contracts['spaces.reply'],
    { preHandler: [requireAuth, requireMembership(db, 'post:comment'), writeLimit] },
    async (request, { params: { threadId }, body }) => {
      const { workspaceId } = currentMembership(request);
      const user = currentUser(request);
      const thread = await threadIn(db, workspaceId, threadId);
      let parent: ReplyRow | null = null;
      if (body.parentId) {
        parent = await replyIn(db, workspaceId, body.parentId);
        if (!parent || parent.threadId !== thread.id) {
          throw ApiError.badRequest('That reply is not in this thread', 'bad_parent');
        }
      }
      const [{ n } = { n: 0 }] = await db
        .select({ n: count() })
        .from(spaceReplies)
        .where(eq(spaceReplies.threadId, thread.id));
      // A thread holds what a page shows, so no reply is ever out of sight.
      if (n >= SPACE_REPLIES_SHOWN_MAX) {
        throw ApiError.conflict('This thread is full. Start a new one to carry on.', 'thread_full');
      }
      const place = placeReply(parent);
      const row = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(spaceReplies)
          .values({
            workspaceId,
            threadId: thread.id,
            authorId: user.id,
            body: body.body,
            ...place,
          })
          .returning();
        await tx
          .update(spaceThreads)
          .set({ lastActivityAt: created!.createdAt })
          .where(eq(spaceThreads.id, thread.id));
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'space_reply',
          entityId: created!.id,
          eventType: 'space.replied',
          payload: { threadId: thread.id },
        });
        return created!;
      });
      await notify(request, thread.spaceId, thread.id);
      return { reply: replyWire(row, (await replyReactions(db, [row.id])).get(row.id)!) };
    },
  );

  serve(
    app,
    contracts['spaces.deleteReply'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read')] },
    async (request, { params: { replyId } }) => {
      const { workspaceId, role } = currentMembership(request);
      const user = currentUser(request);
      const row = await replyIn(db, workspaceId, replyId);
      if (!row || row.deletedAt) throw ApiError.notFound('Reply not found');
      const own = row.authorId === user.id;
      if (!can(role, own ? 'post:delete_own' : 'post:delete_any')) throw ApiError.forbidden();
      const thread = await threadIn(db, workspaceId, row.threadId);
      await db.transaction(async (tx) => {
        await tx
          .update(spaceReplies)
          .set({ body: '', deletedAt: new Date() })
          .where(eq(spaceReplies.id, row.id));
        await tx.delete(spaceReplyReactions).where(eq(spaceReplyReactions.replyId, row.id));
        if (thread.solvedReplyId === row.id) {
          await tx
            .update(spaceThreads)
            .set({ solvedReplyId: null, solvedAt: null })
            .where(eq(spaceThreads.id, thread.id));
        }
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'space_reply',
          entityId: row.id,
          eventType: 'space.reply_deleted',
          payload: { threadId: thread.id, moderated: !own },
        });
      });
      await notify(request, thread.spaceId, thread.id);
      return undefined;
    },
  );

  serve(
    app,
    contracts['spaces.solve'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read')] },
    async (request, { params: { threadId }, body }) => {
      const { workspaceId, role } = currentMembership(request);
      const user = currentUser(request);
      const thread = await threadIn(db, workspaceId, threadId);
      if (thread.authorId !== user.id && !can(role, 'post:delete_any')) {
        throw ApiError.forbidden('Only whoever asked, or an admin, marks the answer');
      }
      if (thread.kind !== 'question') {
        throw ApiError.badRequest('Only a question has an answer', 'not_a_question');
      }
      const now = new Date();
      // One statement: the reply must still stand, in this thread, as the
      // answer is set, so a reply taken down meanwhile is never the answer.
      const answerStands = body.replyId
        ? sql`exists (select 1 from ${spaceReplies} where ${spaceReplies.id} = ${body.replyId}
            and ${spaceReplies.threadId} = ${thread.id} and ${spaceReplies.deletedAt} is null)`
        : undefined;
      const set = await db
        .update(spaceThreads)
        .set({
          solvedReplyId: body.replyId,
          solvedAt: body.replyId ? now : null,
          lastActivityAt: now,
        })
        .where(and(eq(spaceThreads.id, thread.id), answerStands))
        .returning({ id: spaceThreads.id });
      if (set.length === 0) {
        throw ApiError.badRequest('That reply is not in this thread', 'bad_answer');
      }
      await notify(request, thread.spaceId, thread.id);
      return { solvedReplyId: body.replyId };
    },
  );

  /** What a reaction is on: a thread, or a reply still standing, in this workspace. */
  async function targetOf(workspaceId: string, targetId: string) {
    const thread = await threadIn(db, workspaceId, targetId).catch((error: unknown) => {
      // Not a thread: perhaps a reply. Anything else is a real failure.
      if (error instanceof ApiError && error.statusCode === 404) return null;
      throw error;
    });
    if (thread)
      return {
        kind: 'thread' as const,
        id: thread.id,
        spaceId: thread.spaceId,
        threadId: thread.id,
      };
    const reply = await replyIn(db, workspaceId, targetId);
    if (!reply || reply.deletedAt) throw ApiError.notFound('Nothing to react to');
    const parent = await threadIn(db, workspaceId, reply.threadId);
    return { kind: 'reply' as const, id: reply.id, spaceId: parent.spaceId, threadId: parent.id };
  }

  async function toggle(
    request: FastifyRequest,
    targetId: string,
    reaction: PostReaction,
    on: boolean,
  ) {
    const { workspaceId } = currentMembership(request);
    const user = currentUser(request);
    const target = await targetOf(workspaceId, targetId);
    let changed: unknown[];
    if (target.kind === 'thread') {
      const key = { threadId: target.id, userId: user.id, reaction };
      changed = on
        ? await db.insert(spaceThreadReactions).values(key).onConflictDoNothing().returning()
        : await db
            .delete(spaceThreadReactions)
            .where(
              and(
                eq(spaceThreadReactions.threadId, target.id),
                eq(spaceThreadReactions.userId, user.id),
                eq(spaceThreadReactions.reaction, reaction),
              ),
            )
            .returning();
    } else {
      const key = { replyId: target.id, userId: user.id, reaction };
      changed = on
        ? await db.insert(spaceReplyReactions).values(key).onConflictDoNothing().returning()
        : await db
            .delete(spaceReplyReactions)
            .where(
              and(
                eq(spaceReplyReactions.replyId, target.id),
                eq(spaceReplyReactions.userId, user.id),
                eq(spaceReplyReactions.reaction, reaction),
              ),
            )
            .returning();
    }
    // Already so: nothing changed, so nobody is told.
    if (changed.length > 0) await notify(request, target.spaceId, target.threadId);
  }

  serve(
    app,
    contracts['spaces.react'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read'), reactLimit] },
    async (request, { params: { targetId, reaction } }) => {
      await toggle(request, targetId, reaction, true);
      return undefined;
    },
  );

  serve(
    app,
    contracts['spaces.unreact'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read'), reactLimit] },
    async (request, { params: { targetId, reaction } }) => {
      await toggle(request, targetId, reaction, false);
      return undefined;
    },
  );
}
