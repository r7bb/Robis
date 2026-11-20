import type { ProjectHealthState } from '@robis/shared';

/**
 * Project health (Phase 2c): a state worked out from a project's issues
 * by rules short enough to check by eye against the numbers shown beside
 * it. Nothing is predicted and nothing is stored.
 */

/** The window "recently" means: done or filed in the last seven days. */
export const RECENT_DAYS = 7;
/** With open issues and nothing changed for this long, a project is quiet. */
export const QUIET_DAYS = 14;
/** Projects the Feed shows; the board has the rest. */
export const PROJECTS_SHOWN = 6;

const DAY_MS = 86_400_000;

export type ProjectStats = {
  open: number;
  done: number;
  overdue: number;
  urgent: number;
  lastMovedAt: Date;
  /** When its latest issue was done, or null if none is. */
  lastDoneAt: Date | null;
};

/** The state, by the first rule that holds, in this order. */
export function healthOf(stats: ProjectStats, now: Date): ProjectHealthState {
  if (stats.open === 0 && stats.done > 0) return 'finished';
  if (stats.overdue > 0 || stats.urgent > 0) return 'needs_a_look';
  if (now.getTime() - stats.lastMovedAt.getTime() > QUIET_DAYS * DAY_MS) return 'quiet';
  return 'on_track';
}

/**
 * Whether the Feed shows it: a project finished long ago, or with every
 * issue cancelled, is history, not news.
 */
export function worthShowing(stats: ProjectStats, now: Date): boolean {
  if (stats.open > 0) return true;
  return (
    stats.lastDoneAt !== null && now.getTime() - stats.lastDoneAt.getTime() <= QUIET_DAYS * DAY_MS
  );
}

const ORDER: Record<ProjectHealthState, number> = {
  needs_a_look: 0,
  on_track: 1,
  quiet: 2,
  finished: 3,
};

/** What needs a look first, then the busiest. */
export function byAttention(
  a: { state: ProjectHealthState; lastMovedAt: Date },
  b: { state: ProjectHealthState; lastMovedAt: Date },
): number {
  return ORDER[a.state] - ORDER[b.state] || b.lastMovedAt.getTime() - a.lastMovedAt.getTime();
}

export const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS);

/**
 * The day overdue is judged on: the viewer's own today when it is within a
 * day of the server's (every time zone is), else the server's, in UTC.
 */
export function todayFor(viewerToday: string | undefined, now: Date): string {
  const server = now.toISOString().slice(0, 10);
  if (!viewerToday) return server;
  const apart = Math.abs(
    Date.parse(`${viewerToday}T00:00:00Z`) - Date.parse(`${server}T00:00:00Z`),
  );
  return apart <= DAY_MS ? viewerToday : server;
}
