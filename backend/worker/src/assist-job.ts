import {
  type AssistInput,
  type AssistJob,
  type AssistResult,
  assistRequests,
  type Database,
} from '@robis/database';
import { log } from '@robis/telemetry/log';
import { and, eq } from 'drizzle-orm';
import type { Assistant } from './assist.ts';
import type { JobHandler } from './runner.ts';

/**
 * Answer one ask for assistance (D3): read what to ask, ask the provider
 * through `assistant`, write back the checked answer, and clear what was
 * asked either way, so a person's words are kept no longer than it takes.
 * With no provider (no key on this worker), the ask fails at once and says
 * so, rather than waiting for ever.
 */
export function assistHandler(assistant: Assistant | undefined): JobHandler {
  return async (payload, { db }: { db: Database }) => {
    const { requestId } = (payload ?? {}) as Partial<AssistJob>;
    if (!requestId) throw new Error('assist.ask: requestId is required');
    const input = await pendingAsk(db, requestId);
    if (!input) return;
    if (!assistant) log.warn('assist: no provider key on this worker; the ask failed');
    const result = assistant ? await answer(assistant, input) : null;
    await settle(db, requestId, result);
  };
}

/** What a pending ask asks; null when it is gone or already answered (a redelivery). */
async function pendingAsk(db: Database, requestId: string): Promise<AssistInput | null> {
  const [row] = await db
    .select({ input: assistRequests.input, status: assistRequests.status })
    .from(assistRequests)
    .where(eq(assistRequests.id, requestId));
  if (row?.status !== 'pending' || !row.input) return null;
  return (typeof row.input === 'string' ? JSON.parse(row.input) : row.input) as AssistInput;
}

/** The answer written back, or the failure, and what was asked cleared either way. */
async function settle(db: Database, requestId: string, result: AssistResult | null) {
  await db
    .update(assistRequests)
    .set({
      status: result ? 'done' : 'failed',
      result: result ? JSON.stringify(result) : null,
      input: null,
    })
    .where(and(eq(assistRequests.id, requestId), eq(assistRequests.status, 'pending')));
}

async function answer(assistant: Assistant, input: AssistInput): Promise<AssistResult | null> {
  switch (input.kind) {
    case 'summary': {
      const points = await assistant.summarise(input.subject, input.snippets);
      return points ? { kind: 'summary', points } : null;
    }
    case 'agenda': {
      const items = await assistant.agenda(input.meeting, input.issues);
      return items
        ? {
            kind: 'agenda',
            items,
            issues: input.issues.map(({ id, key, title }) => ({ id, key, title })),
          }
        : null;
    }
    case 'issue': {
      const draft = await assistant.draftIssue(input.message);
      return draft ? { kind: 'issue', ...draft } : null;
    }
    case 'intent': {
      const parts = await assistant.interpret(input.request);
      return parts ? { kind: 'intent', parts } : null;
    }
  }
}
