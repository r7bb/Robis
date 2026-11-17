import { and, desc, eq, gt, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import type { Executor } from './index.ts';
import { agentRuns, agentSteps } from './schema.ts';

/**
 * Agent runs and their steps (B6).
 *
 * A run is a stretch of an agent's work. The triage agent's runs are exact:
 * each uses a token made for that run alone, so the token names the run.
 * Another agent's calls belong to the run its client named, if it sent a
 * run id, and otherwise to its latest run unless it has been quiet for
 * longer than `RUN_IDLE_MS`, when a new one starts.
 */

export const RUN_IDLE_MS = 30 * 60_000;
/** A run's last-step time is rewritten at most this often: close enough for grouping. */
const LAST_STEP_WRITE_MS = 30_000;

export type AgentStepOutcome = 'ok' | 'denied' | 'error';

export type AgentStep = {
  workspaceId: string;
  agentId: string;
  /** The run's own key: a per-run token's id, or the id the caller sent. */
  runKey: string | null;
  source: 'triage' | 'calls';
  tool: string;
  outcome: AgentStepOutcome;
  status: number;
  durationMs: number;
};

/** A refusal a person would also get is a denial; anything else that failed is an error. */
export function outcomeOf(status: number): AgentStepOutcome {
  if (status < 400) return 'ok';
  return status === 401 || status === 403 || status === 404 ? 'denied' : 'error';
}

async function runFor(db: Executor, step: AgentStep, now: Date): Promise<string> {
  if (step.runKey) {
    const [run] = await db
      .insert(agentRuns)
      .values({
        workspaceId: step.workspaceId,
        agentId: step.agentId,
        source: step.source,
        runKey: step.runKey,
        startedAt: now,
        lastStepAt: now,
      })
      .onConflictDoUpdate({
        target: [agentRuns.agentId, agentRuns.workspaceId, agentRuns.runKey],
        set: {
          lastStepAt: sql`greatest(${agentRuns.lastStepAt}, ${now.toISOString()}::timestamptz)`,
        },
      })
      .returning({ id: agentRuns.id });
    return run!.id;
  }

  const [recent] = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.agentId, step.agentId),
        eq(agentRuns.workspaceId, step.workspaceId),
        isNull(agentRuns.runKey),
        gt(agentRuns.lastStepAt, new Date(now.getTime() - RUN_IDLE_MS)),
      ),
    )
    .orderBy(desc(agentRuns.lastStepAt))
    .limit(1);
  if (recent) return recent.id;

  const [run] = await db
    .insert(agentRuns)
    .values({
      workspaceId: step.workspaceId,
      agentId: step.agentId,
      source: step.source,
      startedAt: now,
      lastStepAt: now,
    })
    .returning({ id: agentRuns.id });
  return run!.id;
}

/** Record one call an agent made, in its run. */
export async function recordAgentStep(db: Executor, step: AgentStep, now = new Date()) {
  const runId = await runFor(db, step, now);
  await db.insert(agentSteps).values({
    runId,
    workspaceId: step.workspaceId,
    tool: step.tool,
    outcome: step.outcome,
    status: step.status,
    durationMs: Math.max(0, Math.round(step.durationMs)),
    at: now,
  });
  await db
    .update(agentRuns)
    .set({ lastStepAt: now })
    .where(
      and(
        eq(agentRuns.id, runId),
        lt(agentRuns.lastStepAt, new Date(now.getTime() - LAST_STEP_WRITE_MS)),
      ),
    );
  return runId;
}

/**
 * Steps are written after the answer has gone out, so a caller never waits
 * on them. These are the writes still in flight: settled before a test
 * resets the database and before the API shuts down, as the account trail's
 * deferred writes are.
 */
const deferred = new Set<Promise<unknown>>();

export function deferAgentStep(db: Executor, step: AgentStep, onError: (error: unknown) => void) {
  const write = recordAgentStep(db, step).catch(onError);
  deferred.add(write);
  write.finally(() => deferred.delete(write));
}

export async function settleAgentSteps() {
  await Promise.all([...deferred]);
}

/**
 * A workspace's latest runs, newest first, each with its first steps and its
 * total: three queries, whatever the number of runs.
 */
export async function latestRuns(
  db: Executor,
  workspaceId: string,
  limits: { runs: number; steps: number },
) {
  const runs = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.workspaceId, workspaceId))
    .orderBy(desc(agentRuns.startedAt))
    .limit(limits.runs);
  if (runs.length === 0) return [];
  const ids = runs.map((run) => run.id);

  const numbered = db
    .select({
      id: agentSteps.id,
      runId: agentSteps.runId,
      tool: agentSteps.tool,
      outcome: agentSteps.outcome,
      status: agentSteps.status,
      durationMs: agentSteps.durationMs,
      at: agentSteps.at,
      place:
        sql<number>`row_number() over (partition by ${agentSteps.runId} order by ${agentSteps.id})`.as(
          'place',
        ),
    })
    .from(agentSteps)
    .where(inArray(agentSteps.runId, ids))
    .as('numbered');
  const [steps, totals] = await Promise.all([
    db.select().from(numbered).where(lte(numbered.place, limits.steps)).orderBy(numbered.id),
    db
      .select({ runId: agentSteps.runId, n: sql<number>`count(*)::int` })
      .from(agentSteps)
      .where(inArray(agentSteps.runId, ids))
      .groupBy(agentSteps.runId),
  ]);

  return runs.map((run) => ({
    id: run.id,
    agentId: run.agentId,
    source: run.source,
    startedAt: run.startedAt,
    lastStepAt: run.lastStepAt,
    stepCount: totals.find((t) => t.runId === run.id)?.n ?? 0,
    steps: steps
      .filter((step) => step.runId === run.id)
      .map(({ runId: _runId, place: _place, ...step }) => step),
  }));
}
