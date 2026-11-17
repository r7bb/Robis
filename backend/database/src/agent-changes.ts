import { and, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { Executor } from './index.ts';
import { agentChanges, agentRuns, comments, issues, suggestionFeedback } from './schema.ts';

/**
 * What became of an agent's changes (B6): kept, edited or reverted by the
 * people who came after it. Each change is stored with the value before and
 * after, because the audit trail keeps only the names of the fields that
 * changed, which cannot tell an edit from an undo. Judged once seven days
 * old: still the agent's value is kept, the earlier value again (or the
 * thing deleted) is reverted, anything else is edited.
 */

export const JUDGE_AFTER_DAYS = 7;
/** Runs, steps and judgements are kept this long, then pruned. */
export const AGENT_HISTORY_DAYS = 90;
/** Hint feedback is kept this long: enough for a year's acceptance rate. */
export const FEEDBACK_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The fields an agent may set on an issue, as they are compared later. */
export const ISSUE_FIELDS = [
  'title',
  'description',
  'status',
  'priority',
  'dueOn',
  'parentId',
] as const;
type IssueField = (typeof ISSUE_FIELDS)[number];

export type AgentChange = {
  workspaceId: string;
  agentId: string;
  entityType: 'issue' | 'comment';
  entityId: string;
  field: IssueField | 'created';
  before: unknown;
  after: unknown;
};

const json = (value: unknown) => (value === undefined ? null : JSON.stringify(value));

/** Record changes an agent made, in the transaction that made them. */
export async function recordAgentChanges(tx: Executor, changes: AgentChange[]) {
  if (changes.length === 0) return;
  await tx.insert(agentChanges).values(
    changes.map((change) => ({
      ...change,
      before: change.field === 'created' ? null : json(change.before),
      after: change.field === 'created' ? null : json(change.after),
    })),
  );
}

type Outcome = 'kept' | 'edited' | 'reverted';

/** What a change came to, from the thing as it is now (null when deleted). */
export function outcomeOfChange(
  change: { field: string; before: string | null; after: string | null },
  current: Record<string, unknown> | null,
): Outcome {
  if (!current) return 'reverted';
  if (change.field === 'created') return 'kept';
  const now = JSON.stringify(current[change.field] ?? null);
  if (now === change.after) return 'kept';
  if (now === change.before) return 'reverted';
  return 'edited';
}

/** Judge every change old enough to judge. Returns how many were judged. */
export async function judgeAgentChanges(db: Executor, now = new Date()): Promise<number> {
  const due = await db
    .select()
    .from(agentChanges)
    .where(
      and(
        isNull(agentChanges.judgedAt),
        lt(agentChanges.at, new Date(now.getTime() - JUDGE_AFTER_DAYS * DAY_MS)),
      ),
    )
    .limit(500);
  if (due.length === 0) return 0;

  const issueIds = due.filter((c) => c.entityType === 'issue').map((c) => c.entityId);
  const commentIds = due.filter((c) => c.entityType === 'comment').map((c) => c.entityId);
  const currentIssues = issueIds.length
    ? await db
        .select({
          id: issues.id,
          title: issues.title,
          description: issues.description,
          status: issues.status,
          priority: issues.priority,
          dueOn: issues.dueOn,
          parentId: issues.parentId,
        })
        .from(issues)
        .where(inArray(issues.id, issueIds))
    : [];
  const currentComments = commentIds.length
    ? await db.select({ id: comments.id }).from(comments).where(inArray(comments.id, commentIds))
    : [];
  const byId = new Map<string, Record<string, unknown>>([
    ...currentIssues.map((row) => [row.id, row] as const),
    ...currentComments.map((row) => [row.id, row] as const),
  ]);

  for (const change of due) {
    await db
      .update(agentChanges)
      .set({ outcome: outcomeOfChange(change, byId.get(change.entityId) ?? null), judgedAt: now })
      .where(and(eq(agentChanges.id, change.id), isNull(agentChanges.judgedAt)));
  }
  return due.length;
}

/** Prune runs (their steps go with them) and judgements past their days, and old feedback. */
export async function pruneAgentHistory(db: Executor, now = new Date()) {
  const before = new Date(now.getTime() - AGENT_HISTORY_DAYS * DAY_MS);
  await db.delete(agentRuns).where(lt(agentRuns.lastStepAt, before));
  await db
    .delete(agentChanges)
    .where(and(isNotNull(agentChanges.judgedAt), lt(agentChanges.judgedAt, before)));
  await db
    .delete(suggestionFeedback)
    .where(lt(suggestionFeedback.at, new Date(now.getTime() - FEEDBACK_DAYS * DAY_MS)));
}

/** Per agent: changes kept, edited and reverted, and those not judged yet. */
export async function changeCounts(db: Executor, workspaceId: string) {
  const rows = await db
    .select({
      agentId: agentChanges.agentId,
      outcome: agentChanges.outcome,
      n: sql<number>`count(*)::int`,
    })
    .from(agentChanges)
    .where(eq(agentChanges.workspaceId, workspaceId))
    .groupBy(agentChanges.agentId, agentChanges.outcome);
  const counts = new Map<
    string,
    { kept: number; edited: number; reverted: number; pending: number }
  >();
  for (const row of rows) {
    const entry = counts.get(row.agentId) ?? { kept: 0, edited: 0, reverted: 0, pending: 0 };
    entry[row.outcome ?? 'pending'] += row.n;
    counts.set(row.agentId, entry);
  }
  return counts;
}
