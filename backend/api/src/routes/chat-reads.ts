import {
  channelReads,
  channels,
  type Database,
  messageReactions,
  messages,
  publishEvent,
} from '@robis/database';
import {
  contracts,
  isUuid,
  MESSAGE_REACTIONS,
  type MessageReaction,
  UNREAD_SHOWN_MAX,
} from '@robis/shared';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import {
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';
import { loadChannel } from './channels.ts';

/** Reactions a person may add or take off in a minute. */
const REACTIONS_PER_MINUTE = 60;
/**
 * A room never opened counts what came in the last day: someone new is not
 * met with every room's whole history as unread.
 */
const NEVER_READ_WINDOW = sql`interval '1 day'`;

export type ReactionSummary = { reaction: MessageReaction; count: number; mine: boolean };

/** Each message's reactions with anyone on them, in the fixed order, `mine` for this person. */
export async function reactionsFor(
  db: Database,
  messageIds: readonly string[],
  me: string,
): Promise<Map<string, ReactionSummary[]>> {
  const result = new Map<string, ReactionSummary[]>(messageIds.map((id) => [id, []]));
  if (messageIds.length === 0) return result;
  const rows = await db
    .select({
      messageId: messageReactions.messageId,
      reaction: messageReactions.reaction,
      count: count(),
      mine: sql<boolean>`bool_or(${messageReactions.userId} = ${me})`,
    })
    .from(messageReactions)
    .where(inArray(messageReactions.messageId, [...messageIds]))
    .groupBy(messageReactions.messageId, messageReactions.reaction);
  for (const row of rows) result.get(row.messageId)?.push({ ...row, mine: Boolean(row.mine) });
  for (const list of result.values()) {
    list.sort(
      (a, b) => MESSAGE_REACTIONS.indexOf(a.reaction) - MESSAGE_REACTIONS.indexOf(b.reaction),
    );
  }
  return result;
}

/** A message in this workspace, with its room; not found otherwise. */
async function messageIn(db: Database, workspaceId: string, messageId: string) {
  if (!isUuid(messageId)) throw ApiError.notFound('Message not found');
  const [row] = await db
    .select({ id: messages.id, channelId: messages.channelId })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.workspaceId, workspaceId)));
  if (!row) throw ApiError.notFound('Message not found');
  return row;
}

/**
 * Chat that keeps your place: unread counts per room, marking a room read,
 * and quick reactions. A reaction is announced by ids only, as messages are,
 * so whoever hears it re-reads the room through the same authorised route.
 */
export async function chatReadRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;
  const reactLimit = rateLimit({
    name: 'reactions',
    limit: REACTIONS_PER_MINUTE,
    windowMs: 60_000,
  });

  serve(
    app,
    contracts['channels.unread'],
    { preHandler: [requireAuth, requireMembership(db, 'channel:read')] },
    async (request) => {
      const { workspaceId } = currentMembership(request);
      const me = currentUser(request).id;
      const rows = await db
        .select({
          channelId: channels.id,
          lastReadAt: channelReads.lastReadAt,
          unread: sql<number>`(
            select count(*)::int from (
              select 1 from ${messages} m
               where m.channel_id = ${channels.id}
                 and m.author_id <> ${me}
                 and m.created_at > coalesce(${channelReads.lastReadAt}, now() - ${NEVER_READ_WINDOW})
               limit ${UNREAD_SHOWN_MAX + 1}
            ) waiting
          )`,
        })
        .from(channels)
        .leftJoin(
          channelReads,
          and(eq(channelReads.channelId, channels.id), eq(channelReads.userId, me)),
        )
        .where(eq(channels.workspaceId, workspaceId));
      return {
        rooms: rows.map((row) => ({ ...row, unread: Math.min(row.unread, UNREAD_SHOWN_MAX) })),
      };
    },
  );

  serve(
    app,
    contracts['channels.markRead'],
    { preHandler: [requireAuth, requireMembership(db, 'channel:read')] },
    async (request, { params: { channelId } }) => {
      const { workspaceId } = currentMembership(request);
      const me = currentUser(request).id;
      const channel = await loadChannel(db, workspaceId, channelId);
      const now = new Date();
      // Never moved back: a stale tab marking read cannot make old news new.
      const [row] = await db
        .insert(channelReads)
        .values({ channelId: channel.id, userId: me, workspaceId, lastReadAt: now })
        .onConflictDoUpdate({
          target: [channelReads.channelId, channelReads.userId],
          set: { lastReadAt: sql`greatest(${channelReads.lastReadAt}, excluded.last_read_at)` },
        })
        .returning({ lastReadAt: channelReads.lastReadAt });
      return { lastReadAt: row!.lastReadAt };
    },
  );

  async function changed(request: FastifyRequest, messageId: string, channelId: string) {
    const { workspaceId } = currentMembership(request);
    const me = currentUser(request).id;
    await publishEvent(db, {
      type: 'message.reacted',
      workspaceId,
      channelId,
      messageId,
      actorId: me,
    });
    return { reactions: (await reactionsFor(db, [messageId], me)).get(messageId) ?? [] };
  }

  serve(
    app,
    contracts['messages.react'],
    { preHandler: [requireAuth, requireMembership(db, 'message:create'), reactLimit] },
    async (request, { params: { messageId, reaction } }) => {
      const { workspaceId } = currentMembership(request);
      const message = await messageIn(db, workspaceId, messageId);
      await db
        .insert(messageReactions)
        .values({ messageId: message.id, userId: currentUser(request).id, reaction })
        .onConflictDoNothing();
      return changed(request, message.id, message.channelId);
    },
  );

  serve(
    app,
    contracts['messages.unreact'],
    { preHandler: [requireAuth, requireMembership(db, 'message:create'), reactLimit] },
    async (request, { params: { messageId, reaction } }) => {
      const { workspaceId } = currentMembership(request);
      const message = await messageIn(db, workspaceId, messageId);
      await db
        .delete(messageReactions)
        .where(
          and(
            eq(messageReactions.messageId, message.id),
            eq(messageReactions.userId, currentUser(request).id),
            eq(messageReactions.reaction, reaction),
          ),
        );
      return changed(request, message.id, message.channelId);
    },
  );
}
