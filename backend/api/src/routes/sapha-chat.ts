import {
  type Database,
  enqueue,
  SAPHA_REPLY_JOB,
  saphaConversations,
  saphaMessages,
  workspaces,
} from '@robis/database';
import { contracts, isUuid, SAPHA_TURNS_PER_DAY, type SaphaTurn } from '@robis/shared';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
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

/**
 * Sapha, the agent (D3): conversations with assistance turned on. Every
 * route but none of the others answers 404 until the server has a key and
 * an admin has turned assistance on, as the other asks do. A conversation
 * is its owner's alone: anyone else, admins too, gets not found. Each turn
 * is a row the worker answers; nothing here talks to the provider.
 */

/** Turns a person may ask in an hour, on top of the day's. */
const TURNS_PER_HOUR = 30;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** How a conversation is named in the list: its first question, shortened. */
const TITLE_CHARS = 80;
/** Conversations listed at once. */
const LISTED = 50;

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const titleOf = (text: string) => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS - 1)}…` : line;
};

const parsed = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value);

export async function saphaChatRoutes(
  app: FastifyInstance,
  opts: { db: Database; keyed: boolean },
) {
  const { db, keyed } = opts;
  const turnLimit = rateLimit({ name: 'sapha', limit: TURNS_PER_HOUR, windowMs: HOUR_MS });
  const reading = { preHandler: [requireAuth, requireMembership(db, 'issue:read')] };
  const asking = { preHandler: [requireAuth, requireMembership(db, 'issue:read'), turnLimit] };

  async function assertAvailable(request: FastifyRequest) {
    const { workspaceId } = currentMembership(request);
    const [row] = await db
      .select({ on: workspaces.assistEnabled })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    if (!keyed || row?.on !== true) throw ApiError.notFound('Not found');
  }

  /** The asker's own conversation here, or not found. */
  async function ownConversation(request: FastifyRequest, conversationId: string) {
    const { workspaceId } = currentMembership(request);
    if (!isUuid(conversationId)) throw ApiError.notFound('Conversation not found');
    const [row] = await db
      .select({
        id: saphaConversations.id,
        title: saphaConversations.title,
        updatedAt: saphaConversations.updatedAt,
      })
      .from(saphaConversations)
      .where(
        and(
          eq(saphaConversations.id, conversationId),
          eq(saphaConversations.workspaceId, workspaceId),
          eq(saphaConversations.userId, currentUser(request).id),
        ),
      );
    if (!row) throw ApiError.notFound('Conversation not found');
    return row;
  }

  /** A day's turns, across every workspace: each is one or more paid calls. */
  async function assertTurnsLeft(userId: string) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(saphaMessages)
      .innerJoin(saphaConversations, eq(saphaConversations.id, saphaMessages.conversationId))
      .where(
        and(
          eq(saphaConversations.userId, userId),
          eq(saphaMessages.role, 'person'),
          gte(saphaMessages.createdAt, new Date(Date.now() - DAY_MS)),
        ),
      );
    if ((row?.n ?? 0) >= SAPHA_TURNS_PER_DAY) {
      throw new ApiError(
        429,
        'sapha_daily_limit',
        `Sapha has answered ${SAPHA_TURNS_PER_DAY} questions for you today. Try again tomorrow.`,
      );
    }
  }

  /** What was said, and the turn Sapha will answer, with its job. */
  async function addTurn(tx: Tx, conversationId: string, text: string) {
    await tx.insert(saphaMessages).values({ conversationId, role: 'person', text });
    const [reply] = await tx
      .insert(saphaMessages)
      .values({ conversationId, role: 'sapha', status: 'pending' })
      .returning({ id: saphaMessages.id });
    // Once only: a turn that broke fails and says so, and no paid call is made twice for it.
    await enqueue(tx, SAPHA_REPLY_JOB, { messageId: reply!.id }, { maxAttempts: 1 });
    return reply!.id;
  }

  serve(app, contracts['sapha.start'], asking, async (request, { body: { text } }) => {
    await assertAvailable(request);
    const { workspaceId } = currentMembership(request);
    const userId = currentUser(request).id;
    await assertTurnsLeft(userId);
    return db.transaction(async (tx) => {
      const [conversation] = await tx
        .insert(saphaConversations)
        .values({ workspaceId, userId, title: titleOf(text) })
        .returning({ id: saphaConversations.id });
      const replyId = await addTurn(tx, conversation!.id, text);
      return { conversation: { id: conversation!.id }, reply: { id: replyId } };
    });
  });

  serve(
    app,
    contracts['sapha.say'],
    asking,
    async (request, { params: { conversationId }, body: { text } }) => {
      await assertAvailable(request);
      const conversation = await ownConversation(request, conversationId);
      await assertTurnsLeft(currentUser(request).id);
      return db.transaction(async (tx) => {
        // One answer at a time, so the conversation keeps its order.
        const [waiting] = await tx
          .select({ id: saphaMessages.id })
          .from(saphaMessages)
          .where(
            and(
              eq(saphaMessages.conversationId, conversation.id),
              eq(saphaMessages.status, 'pending'),
            ),
          )
          .for('update');
        if (waiting) throw ApiError.conflict('Sapha is still answering', 'still_answering');
        const replyId = await addTurn(tx, conversation.id, text);
        await tx
          .update(saphaConversations)
          .set({ updatedAt: new Date() })
          .where(eq(saphaConversations.id, conversation.id));
        return { reply: { id: replyId } };
      });
    },
  );

  serve(app, contracts['sapha.conversation'], reading, async (request, { params }) => {
    await assertAvailable(request);
    const conversation = await ownConversation(request, params.conversationId);
    const rows = await db
      .select()
      .from(saphaMessages)
      .where(eq(saphaMessages.conversationId, conversation.id))
      .orderBy(
        asc(saphaMessages.createdAt),
        // Asked and its answer share a moment: the asking comes first.
        sql`case when ${saphaMessages.role} = 'person' then 0 else 1 end`,
      );
    const turns: SaphaTurn[] = rows.map((row) => ({
      id: row.id,
      role: row.role,
      text: row.text,
      status: row.status,
      steps: parsed(row.steps) ?? [],
      proposals: parsed(row.proposals) ?? [],
      issues: parsed(row.issues) ?? [],
      createdAt: row.createdAt.toISOString(),
    }));
    return {
      conversation: { ...conversation, updatedAt: conversation.updatedAt.toISOString() },
      turns,
    };
  });

  serve(app, contracts['sapha.conversations'], reading, async (request) => {
    await assertAvailable(request);
    const { workspaceId } = currentMembership(request);
    const rows = await db
      .select({
        id: saphaConversations.id,
        title: saphaConversations.title,
        updatedAt: saphaConversations.updatedAt,
      })
      .from(saphaConversations)
      .where(
        and(
          eq(saphaConversations.workspaceId, workspaceId),
          eq(saphaConversations.userId, currentUser(request).id),
        ),
      )
      .orderBy(desc(saphaConversations.updatedAt))
      .limit(LISTED);
    return {
      conversations: rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
    };
  });

  serve(app, contracts['sapha.forget'], reading, async (request, { params }, reply) => {
    const conversation = await ownConversation(request, params.conversationId);
    await db.delete(saphaConversations).where(eq(saphaConversations.id, conversation.id));
    return reply.code(204).send();
  });

  serve(app, contracts['sapha.forgetAll'], reading, async (request, _input, reply) => {
    const { workspaceId } = currentMembership(request);
    await db
      .delete(saphaConversations)
      .where(
        and(
          eq(saphaConversations.workspaceId, workspaceId),
          eq(saphaConversations.userId, currentUser(request).id),
        ),
      );
    return reply.code(204).send();
  });
}
