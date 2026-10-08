import {
  channels,
  type Database,
  decodeCursor,
  encodeCursor,
  messages,
  publishEvent,
  users,
} from '@robis/database';
import {
  can,
  createChannelSchema,
  createMessageSchema,
  isUuid,
  listMessagesQuerySchema,
  updateChannelSchema,
} from '@robis/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors.ts';
import {
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';
import { parse } from '../validate.ts';

/**
 * Workspace chat.
 *
 * Shaped like the issue-comment routes on purpose: same tenancy check, same
 * 404-not-403 for anything outside the caller's workspace, same split between
 * deleting your own words and moderating someone else's. Chat is a second
 * place to talk, not a second security model.
 */

/**
 * Resolve a channel inside the caller's workspace, or 404.
 *
 * The workspace predicate is not redundant with the id lookup: without it a
 * member of workspace A who guesses a channel id in workspace B would read
 * B's conversation. Not found rather than forbidden, so the reply does not
 * confirm the channel exists.
 */
async function loadChannel(db: Database, workspaceId: string, channelId: string) {
  if (!isUuid(channelId)) throw ApiError.notFound('Channel not found');

  const [channel] = await db
    .select({ id: channels.id, name: channels.name, topic: channels.topic })
    .from(channels)
    .where(and(eq(channels.id, channelId), eq(channels.workspaceId, workspaceId)))
    .limit(1);

  if (!channel) throw ApiError.notFound('Channel not found');
  return channel;
}

export async function channelRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  app.get(
    '/workspaces/:workspaceId/channels',
    { preHandler: [requireAuth, requireMembership(db, 'channel:read')] },
    async (request) => {
      const { workspaceId } = currentMembership(request);

      const rows = await db
        .select({
          id: channels.id,
          name: channels.name,
          topic: channels.topic,
          createdAt: channels.createdAt,
        })
        .from(channels)
        .where(eq(channels.workspaceId, workspaceId))
        .orderBy(asc(channels.name));

      return { channels: rows };
    },
  );

  app.post(
    '/workspaces/:workspaceId/channels',
    { preHandler: [requireAuth, requireMembership(db, 'channel:create')] },
    async (request, reply) => {
      const user = currentUser(request);
      const { workspaceId } = currentMembership(request);
      const input = parse(createChannelSchema, request.body);

      /*
       * The unique index decides, not a prior SELECT.
       *
       * Two people creating `#standup` at once would both see "available" and
       * both insert. Letting the constraint reject one and translating that
       * into a 409 is the only version without a race.
       */
      const [created] = await db
        .insert(channels)
        .values({
          workspaceId,
          name: input.name,
          topic: input.topic ?? null,
          createdById: user.id,
        })
        .onConflictDoNothing({ target: [channels.workspaceId, channels.name] })
        .returning();

      if (!created) {
        throw ApiError.conflict(`There is already a #${input.name} channel`, 'channel_exists');
      }

      await publishEvent(db, {
        type: 'channel.created',
        workspaceId,
        channelId: created.id,
        actorId: user.id,
      });

      return reply.status(201).send({ channel: created });
    },
  );

  app.patch(
    '/workspaces/:workspaceId/channels/:channelId',
    { preHandler: [requireAuth, requireMembership(db, 'channel:update')] },
    async (request) => {
      const { workspaceId } = currentMembership(request);
      const { channelId } = request.params as { channelId: string };
      const input = parse(updateChannelSchema, request.body);

      await loadChannel(db, workspaceId, channelId);

      const [updated] = await db
        .update(channels)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(channels.id, channelId), eq(channels.workspaceId, workspaceId)))
        .returning();

      return { channel: updated };
    },
  );

  app.delete(
    '/workspaces/:workspaceId/channels/:channelId',
    { preHandler: [requireAuth, requireMembership(db, 'channel:delete')] },
    async (request, reply) => {
      const user = currentUser(request);
      const { workspaceId } = currentMembership(request);
      const { channelId } = request.params as { channelId: string };

      await loadChannel(db, workspaceId, channelId);

      // Messages go with it, by the foreign key's cascade. That is the
      // intent: a deleted channel leaving orphaned transcripts behind would
      // be worse than losing them, because nothing would ever show them again
      // and nobody would know they were still stored.
      await db
        .delete(channels)
        .where(and(eq(channels.id, channelId), eq(channels.workspaceId, workspaceId)));

      await publishEvent(db, {
        type: 'channel.deleted',
        workspaceId,
        channelId,
        actorId: user.id,
      });

      return reply.status(204).send();
    },
  );

  /**
   * A page of history, newest first.
   *
   * Newest-first because that is what a chat window opens on, and paging
   * backwards from there is how people read upward. The client reverses each
   * page for display; the alternative -- oldest-first with an offset to the
   * end -- cannot answer "the latest 50" without counting the whole channel.
   */
  app.get(
    '/workspaces/:workspaceId/channels/:channelId/messages',
    { preHandler: [requireAuth, requireMembership(db, 'channel:read')] },
    async (request) => {
      const { workspaceId } = currentMembership(request);
      const { channelId } = request.params as { channelId: string };
      const query = parse(listMessagesQuerySchema, request.query);

      await loadChannel(db, workspaceId, channelId);

      const filters = [eq(messages.channelId, channelId), eq(messages.workspaceId, workspaceId)];

      const cursorId = decodeCursor(query.cursor);
      if (cursorId) {
        // Sort key read back from the row, not carried in the cursor -- see
        // the note in backend/database/src/pagination.ts.
        filters.push(
          sql`(${messages.createdAt}, ${messages.id}) < (
            select created_at, id from messages where id = ${cursorId}::uuid
          )`,
        );
      }

      const rows = await db
        .select({
          id: messages.id,
          channelId: messages.channelId,
          body: messages.body,
          createdAt: messages.createdAt,
          editedAt: messages.editedAt,
          authorId: messages.authorId,
          authorName: users.name,
        })
        .from(messages)
        .innerJoin(users, eq(users.id, messages.authorId))
        .where(and(...filters))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(query.limit);

      const last = rows.at(-1);

      return {
        messages: rows,
        nextCursor: rows.length === query.limit && last ? encodeCursor(last.id) : null,
      };
    },
  );

  app.post(
    '/workspaces/:workspaceId/channels/:channelId/messages',
    { preHandler: [requireAuth, requireMembership(db, 'message:create')] },
    async (request, reply) => {
      const user = currentUser(request);
      const { workspaceId } = currentMembership(request);
      const { channelId } = request.params as { channelId: string };
      const input = parse(createMessageSchema, request.body);

      await loadChannel(db, workspaceId, channelId);

      const [created] = await db
        .insert(messages)
        .values({ workspaceId, channelId, authorId: user.id, body: input.body })
        .returning();

      // Published after the insert commits. Fanning out first would tell
      // clients to fetch a message that is not yet readable.
      await publishEvent(db, {
        type: 'message.created',
        workspaceId,
        channelId,
        messageId: created!.id,
        actorId: user.id,
      });

      return reply.status(201).send({
        message: { ...created!, authorName: user.name },
      });
    },
  );

  app.delete(
    '/workspaces/:workspaceId/messages/:messageId',
    { preHandler: [requireAuth, requireMembership(db, 'channel:read')] },
    async (request, reply) => {
      const user = currentUser(request);
      const { workspaceId, role } = currentMembership(request);
      const { messageId } = request.params as { messageId: string };

      if (!isUuid(messageId)) throw ApiError.notFound('Message not found');

      const [message] = await db
        .select({ id: messages.id, authorId: messages.authorId, channelId: messages.channelId })
        .from(messages)
        .where(and(eq(messages.id, messageId), eq(messages.workspaceId, workspaceId)))
        .limit(1);

      if (!message) throw ApiError.notFound('Message not found');

      const isAuthor = message.authorId === user.id;
      const allowed = isAuthor ? can(role, 'message:delete_own') : can(role, 'message:delete_any');

      if (!allowed) throw ApiError.forbidden();

      await db
        .delete(messages)
        .where(and(eq(messages.id, messageId), eq(messages.workspaceId, workspaceId)));

      await publishEvent(db, {
        type: 'message.deleted',
        workspaceId,
        channelId: message.channelId,
        messageId,
        actorId: user.id,
      });

      return reply.status(204).send();
    },
  );
}
