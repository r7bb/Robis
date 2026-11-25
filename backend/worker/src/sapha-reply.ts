import {
  type Database,
  type SaphaReplyJob,
  saphaConversations,
  saphaMessages,
  workspaceMembers,
  workspaces,
} from '@robis/database';
import { SAPHA_KEPT_DAYS } from '@robis/shared';
import { log } from '@robis/telemetry/log';
import { and, asc, eq, lt, ne, sql } from 'drizzle-orm';
import type { JobHandler } from './runner.ts';
import { type AgentModel, type AgentTurn, runAgent } from './sapha-agent.ts';

/**
 * Answer one pending turn of a conversation with Sapha. Asked again of the
 * workspace now: one that turned assistance off, or a person no longer in
 * it, gets no answer and nothing is sent. Without a provider key on this
 * worker, the turn fails at once and says so.
 */

/** Earlier turns sent with a new one, so a follow-up is understood. */
const HISTORY_TURNS = 12;
/** What a turn that could not be answered says. */
export const NO_ANSWER = 'Sapha could not answer that just now. Try again in a moment.';
const DAY_MS = 86_400_000;

export function saphaReplyHandler(model: AgentModel | undefined): JobHandler {
  return async (payload, { db }: { db: Database }) => {
    const { messageId } = (payload ?? {}) as Partial<SaphaReplyJob>;
    if (!messageId) throw new Error('sapha.reply: messageId is required');
    const pending = await pendingTurn(db, messageId);
    if (!pending) return;
    if (!model) log.warn('sapha: no provider key on this worker; the turn failed');
    if (!model || !(await mayAsk(db, pending.workspaceId, pending.userId))) {
      return settle(db, messageId, null);
    }
    try {
      const history = await historyOf(db, pending.conversationId, messageId);
      const answer = await runAgent(
        model,
        db,
        { workspaceId: pending.workspaceId, userId: pending.userId, now: new Date() },
        history,
      );
      await settle(db, messageId, answer);
    } catch (error) {
      // Never left waiting: a turn that broke fails and says so, and is not
      // tried again, so no paid call is made twice for it.
      log.warn(
        `sapha: the turn broke (${error instanceof Error ? error.name : 'unknown'}); it failed`,
      );
      await settle(db, messageId, null);
    }
  };
}

async function pendingTurn(db: Database, messageId: string) {
  const [row] = await db
    .select({
      status: saphaMessages.status,
      role: saphaMessages.role,
      conversationId: saphaMessages.conversationId,
      workspaceId: saphaConversations.workspaceId,
      userId: saphaConversations.userId,
    })
    .from(saphaMessages)
    .innerJoin(saphaConversations, eq(saphaConversations.id, saphaMessages.conversationId))
    .where(eq(saphaMessages.id, messageId));
  return row?.status === 'pending' && row.role === 'sapha' ? row : null;
}

/** Assistance still on here, and the asker still a member. */
async function mayAsk(db: Database, workspaceId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ on: workspaces.assistEnabled })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, userId)),
    )
    .where(eq(workspaces.id, workspaceId));
  return row?.on === true;
}

/** The conversation so far, oldest first, up to the turn being answered. */
/** The exchange from its first question on, never from an answer cut from its question. */
export function startingWithPerson<T extends { role: 'person' | 'sapha' }>(
  rows: readonly T[],
): T[] {
  const from = rows.findIndex((row) => row.role === 'person');
  return from < 0 ? [] : rows.slice(from);
}

async function historyOf(
  db: Database,
  conversationId: string,
  answeringId: string,
): Promise<AgentTurn[]> {
  const rows = await db
    .select({ role: saphaMessages.role, text: saphaMessages.text, status: saphaMessages.status })
    .from(saphaMessages)
    .where(and(eq(saphaMessages.conversationId, conversationId), ne(saphaMessages.id, answeringId)))
    .orderBy(
      asc(saphaMessages.createdAt),
      // Asked and its answer share a moment: the asking comes first.
      sql`case when ${saphaMessages.role} = 'person' then 0 else 1 end`,
    );
  const kept = rows.filter((row) => row.status === 'done' && row.text.trim()).slice(-HISTORY_TURNS);
  return startingWithPerson(kept).map((row) =>
    row.role === 'person'
      ? { role: 'person' as const, text: row.text }
      : { role: 'sapha' as const, text: row.text, calls: [] },
  );
}

async function settle(
  db: Database,
  messageId: string,
  answer: Awaited<ReturnType<typeof runAgent>>,
) {
  await db
    .update(saphaMessages)
    .set(
      answer
        ? {
            status: 'done',
            text: answer.text,
            steps: answer.steps,
            proposals: answer.proposals,
            issues: answer.issues,
          }
        : { status: 'failed', text: NO_ANSWER },
    )
    .where(and(eq(saphaMessages.id, messageId), eq(saphaMessages.status, 'pending')));
}

/** Conversations past their 30 days since the last turn, cleared with their turns. */
export function saphaRetentionHandler(): JobHandler {
  return async (_payload, { db }: { db: Database }) => {
    const before = new Date(Date.now() - SAPHA_KEPT_DAYS * DAY_MS);
    await db.delete(saphaConversations).where(lt(saphaConversations.updatedAt, before));
  };
}
