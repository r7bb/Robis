import { INSIGHT_MIN_SAMPLE, INSIGHT_WEEKS, type IssueStatus } from '@robis/shared';

/**
 * Cycle time and throughput (Phase 6), from the status changes the audit
 * trail keeps. Pure functions over those moves, so the rules are checked
 * against hand-worked answers without a database (tests/insights-flow.test.ts).
 *
 * The rules, as the page states them:
 * - An issue is finished at its last move to done, and counts only while it
 *   is still done: one reopened and not yet redone has not been finished.
 *   One filed already done, with no move at all, finished when it was filed.
 * - It started at its first move into work (in progress or in review). One
 *   created already in work started when it was created. One reopened
 *   starts again from the reopen, so time spent sitting in done is not work.
 *   One with no move into work (straight from to do to done, or filed done)
 *   is counted but not timed.
 * - Each figure is in the window only by its finish, so a long-running issue
 *   finished this week counts its whole time.
 */

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const IN_WORK: ReadonlySet<string> = new Set<IssueStatus>(['IN_PROGRESS', 'IN_REVIEW']);

/** One status change, as the audit trail records it, in trail order. */
export type StatusMove = { at: Date; from: string | null; to: string | null };

/** When an issue was finished and, if the trail shows it, started. */
export type IssueSpan = { startedAt: Date | null; doneAt: Date };

/** What the trail and the row say about one done issue. */
export type DoneIssue = { createdAt: Date; completedAt: Date | null; moves: readonly StatusMove[] };

/** Where the issue last left done, or -1 if it never did. */
function lastReopen(moves: readonly StatusMove[]): number {
  for (let i = moves.length - 1; i >= 0; i--) if (moves[i]!.from === 'DONE') return i;
  return -1;
}

export function issueSpan({ createdAt, completedAt, moves }: DoneIssue): IssueSpan | null {
  if (moves.length === 0) {
    return completedAt ? { startedAt: null, doneAt: completedAt } : null;
  }
  const last = moves.at(-1)!;
  if (last.to !== 'DONE') return null;
  const reopened = lastReopen(moves);
  const stretch = reopened === -1 ? moves : moves.slice(reopened);
  if (reopened === -1 && stretch[0]!.from !== null && IN_WORK.has(stretch[0]!.from)) {
    return { startedAt: createdAt, doneAt: last.at };
  }
  const start = stretch.find((move) => move.to !== null && IN_WORK.has(move.to));
  return { startedAt: start?.at ?? null, doneAt: last.at };
}

/**
 * The q-th quantile of sorted values, interpolating between neighbours: the
 * same answer as Postgres's `percentile_cont` and NumPy's default.
 */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) throw new RangeError('quantile of nothing');
  const position = q * (sorted.length - 1);
  const below = Math.floor(position);
  const above = Math.ceil(position);
  const low = sorted[below]!;
  return low + (sorted[above]! - low) * (position - below);
}

const MEDIAN = 0.5;
const LOWER_QUARTILE = 0.25;
const UPPER_QUARTILE = 0.75;
/** The point one in ten took longer than. */
const ONE_IN_TEN = 0.9;

export type CycleTime = {
  medianSeconds: number;
  p25Seconds: number;
  p75Seconds: number;
  p90Seconds: number;
};

/** The spread of the timed spans, or null below the minimum sample. */
export function cycleTimeOf(spans: readonly IssueSpan[]): CycleTime | null {
  const seconds = spans
    .filter((span): span is { startedAt: Date; doneAt: Date } => span.startedAt !== null)
    // Never below zero: a creation stamped by the database's clock and a
    // move stamped by the API's can disagree by a moment.
    .map((span) => Math.max(0, (span.doneAt.getTime() - span.startedAt.getTime()) / 1000))
    .sort((a, b) => a - b);
  if (seconds.length < INSIGHT_MIN_SAMPLE) return null;
  return {
    medianSeconds: quantile(seconds, MEDIAN),
    p25Seconds: quantile(seconds, LOWER_QUARTILE),
    p75Seconds: quantile(seconds, UPPER_QUARTILE),
    p90Seconds: quantile(seconds, ONE_IN_TEN),
  };
}

/** The start of the window, twelve weeks before now; a finish must come after it. */
export function windowStart(now: Date): Date {
  return new Date(now.getTime() - INSIGHT_WEEKS * WEEK_MS);
}

/**
 * Finishes per week, oldest first, in seven-day steps counted back from
 * now, so the last bar is the last seven days rather than a part week.
 */
export function weeklyCounts(doneAts: readonly Date[], now: Date): number[] {
  const counts = new Array<number>(INSIGHT_WEEKS).fill(0);
  for (const at of doneAts) {
    const weeksAgo = Math.max(0, Math.floor((now.getTime() - at.getTime()) / WEEK_MS));
    const index = INSIGHT_WEEKS - 1 - weeksAgo;
    if (index >= 0) counts[index] = counts[index]! + 1;
  }
  return counts;
}

export type ProjectFlow = {
  finished: number;
  measured: number;
  throughput: number[] | null;
  cycleTime: CycleTime | null;
};

/** One project's figures from its issues' spans, keeping those finished in the window. */
export function projectFlow(spans: readonly IssueSpan[], now: Date): ProjectFlow {
  const since = windowStart(now).getTime();
  // After, not at: the bars count whole weeks back, and the twelfth ends here.
  const inWindow = spans.filter((span) => span.doneAt.getTime() > since);
  const finished = inWindow.length;
  return {
    finished,
    measured: inWindow.filter((span) => span.startedAt !== null).length,
    throughput:
      finished < INSIGHT_MIN_SAMPLE
        ? null
        : weeklyCounts(
            inWindow.map((span) => span.doneAt),
            now,
          ),
    cycleTime: cycleTimeOf(inWindow),
  };
}
