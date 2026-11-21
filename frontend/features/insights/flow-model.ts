import type { contracts, ResponseOf } from '@robis/shared';

/**
 * Cycle time and throughput as the Insights page words them (Phase 6):
 * pure, so what each card says is tested without a browser. Every figure
 * comes with the number of issues behind it, and below the minimum sample
 * the card says so in counts instead of drawing anything.
 */

export type Flow = ResponseOf<(typeof contracts)['insights.flow']>;
export type ProjectFlow = Flow['projects'][number];
type CycleTime = NonNullable<ProjectFlow['cycleTime']>;

export const flowKey = (workspaceId: string) => ['insights-flow', workspaceId] as const;

const HOUR = 3600;
const DAY = 24 * HOUR;
const WEEK_MS = 7 * DAY * 1000;
/** Under two days reads better in hours; beyond, in days. */
const HOURS_UNTIL = 2 * DAY;
/** Below ten days a tenth of a day still means something. */
const TENTHS_UNTIL = 10 * DAY;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A span of time in the unit a person would say it in. */
export function durationLabel(seconds: number): string {
  if (seconds < HOUR) return 'under an hour';
  if (seconds < HOURS_UNTIL) return plural(Math.round(seconds / HOUR), 'hour');
  const days = seconds / DAY;
  if (seconds < TENTHS_UNTIL) {
    const tenths = Math.round(days * 10) / 10;
    return `${tenths} ${tenths === 1 ? 'day' : 'days'}`;
  }
  return plural(Math.round(days), 'day');
}

/**
 * The spread behind the median, in one sentence, worded so a quartile under
 * an hour never reads as "between under an hour and...".
 */
export function spreadSentence(cycle: CycleTime): string {
  if (cycle.p90Seconds < HOUR) return 'Nine in ten took under an hour.';
  const half =
    cycle.p25Seconds < HOUR
      ? `Three in four took under ${durationLabel(cycle.p75Seconds)}`
      : `Half took between ${durationLabel(cycle.p25Seconds)} and ${durationLabel(cycle.p75Seconds)}`;
  return `${half}; one in ten took over ${durationLabel(cycle.p90Seconds)}.`;
}

/** Each week's count, said in words, for the bars' screen-reader list. */
export function weekLines(counts: readonly number[], since: string | Date): string[] {
  return counts.map((n, i) => `Week to ${weekEnding(since, i)}: ${n} finished`);
}

/**
 * What the card says in place of a figure it does not have, or null when
 * it has them all. Counts first, then what would change it.
 */
export function sampleNote(project: ProjectFlow, flow: Pick<Flow, 'minSample' | 'weeks'>) {
  const window = `the last ${flow.weeks} weeks`;
  if (project.finished === 0) return `Nothing finished in ${window}.`;
  if (project.throughput === null) {
    return `Too few to chart yet. Figures appear once ${flow.minSample} have finished in ${window}, since a handful is a guess.`;
  }
  if (project.cycleTime === null) {
    return `Only ${project.measured} of ${project.finished} have a recorded start. A cycle time needs ${flow.minSample}.`;
  }
  return null;
}

/** Issues counted but not timed, said plainly, or null when every one was timed. */
export function untimedNote(project: ProjectFlow): string | null {
  const untimed = project.finished - project.measured;
  if (untimed === 0 || project.cycleTime === null) return null;
  return `${plural(untimed, 'issue')} never moved into work, so ${untimed === 1 ? 'it is' : 'they are'} counted but not timed.`;
}

const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/** The last day of the `index`-th seven-day step after `since`. */
export function weekEnding(since: string | Date, index: number): string {
  const end = new Date(new Date(since).getTime() + (index + 1) * WEEK_MS - 1);
  return dayMonth.format(end);
}

/** The bars' accessible summary: the total, and the last seven days. */
export function throughputLabel(counts: readonly number[]): string {
  const total = counts.reduce((sum, n) => sum + n, 0);
  return `${plural(total, 'issue')} finished over ${counts.length} weeks, ${counts.at(-1) ?? 0} in the last seven days`;
}
