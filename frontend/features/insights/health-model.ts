import type { contracts, ResponseOf } from '@robis/shared';
import { plural } from './flow-model.ts';

/**
 * System health as the Insights page words it (Phase 6): pure, so each
 * tile's figure and line are tested without a browser. A timing is only
 * known to within a bucket, so it reads "within 250 ms"; below the minimum
 * sample a tile gives its count in words instead of a figure.
 */

export type Health = ResponseOf<(typeof contracts)['insights.health']>;
type Server = NonNullable<Health['server']>;
type Reading = Server['syncLag'];
type Acceptance = Health['suggestions']['duplicate'];

export const healthKey = (workspaceId: string) => ['insights-health', workspaceId] as const;

/** The figure and the line under it, for one tile. */
export type Tile = { figure: string | null; line: string };

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** A bucket edge in the unit a person would say it in. */
export function edgeLabel(ms: number): string {
  if (ms < SECOND) return `${ms} ms`;
  if (ms < MINUTE) return plural(ms / SECOND, 'second');
  if (ms < HOUR) return plural(ms / MINUTE, 'minute');
  return plural(ms / HOUR, 'hour');
}

const within = (edge: { withinMs: number | null }) =>
  edge.withinMs === null ? 'over a day' : `within ${edgeLabel(edge.withinMs)}`;

/** A timing tile: the median as the figure, the 95th percentile beneath. */
export function readingTile(reading: Reading, health: Pick<Health, 'hours' | 'minSample'>): Tile {
  const window = `the last ${health.hours} hours`;
  if (reading.median === null || reading.p95 === null) {
    return {
      figure: null,
      line: `${plural(reading.count, 'timing')} in ${window}. Figures appear once ${health.minSample} have.`,
    };
  }
  const from = `From ${plural(reading.count, 'timing')} in ${window}.`;
  // In one bucket, the median says nothing the 95th percentile does not.
  const spread =
    reading.median.withinMs === reading.p95.withinMs
      ? `19 in 20 ${within(reading.p95)}.`
      : `Half ${within(reading.median)}, 19 in 20 ${within(reading.p95)}.`;
  return { figure: within(reading.median), line: `${spread} ${from}` };
}

/** How long something has waited, roughly, in words. */
function waitedLabel(seconds: number): string {
  if (seconds < 60) return plural(Math.round(seconds), 'second');
  if (seconds < 3600) return plural(Math.round(seconds / 60), 'minute');
  return plural(Math.round(seconds / 3600), 'hour');
}

/** The job queue: what is due now, the oldest one's wait, and any dead letters. */
export function queueTile(queue: Server['queue']): Tile {
  const one = queue.deadLetters === 1;
  const dead =
    queue.deadLetters === 0
      ? ''
      : ` ${plural(queue.deadLetters, 'job')} used up ${one ? 'its' : 'their'} attempts and need${one ? 's' : ''} a look.`;
  if (queue.due === 0 || queue.oldestDueSeconds === null) {
    return { figure: 'Clear', line: `Nothing waiting for a worker.${dead}` };
  }
  return {
    figure: `${queue.due} due`,
    line: `The oldest has waited ${waitedLabel(queue.oldestDueSeconds)}.${dead}`,
  };
}

/** One kind of hint: how often it was used, once enough have been answered. */
export function acceptanceTile(acceptance: Acceptance, days: number, minSample: number): Tile {
  const answered = acceptance.accepted + acceptance.dismissed;
  if (acceptance.rate === null) {
    return {
      figure: null,
      line: `${plural(answered, 'answer')} in the last ${days} days. A rate appears once ${minSample} have.`,
    };
  }
  return {
    figure: `${Math.round(acceptance.rate * 100)}% used`,
    line: `${acceptance.accepted} used and ${acceptance.dismissed} set aside in the last ${days} days.`,
  };
}
