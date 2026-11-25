import { dayLine } from '../../lib/i18n/format.ts';

const DAY_MS = 86_400_000;

/** A calendar day moved on by `days`: "2026-11-24" and 3 is "2026-11-27". */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `today` to `endsOn`; 0 on the last day. */
function daysLeft(today: string, endsOn: string): number {
  return Math.round(
    (Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS,
  );
}

/** "ends today", "1 day left", "5 days left". */
export function daysLeftLine(today: string, endsOn: string): string {
  const left = daysLeft(today, endsOn);
  if (left <= 0) return 'ends today';
  return `${left} ${left === 1 ? 'day' : 'days'} left`;
}

/**
 * The first day from `today` no cycle covers: today, or the day after the
 * last cycle planned that has not ended, so a new one never overlaps.
 */
export function firstFreeDay(cycles: readonly { endsOn: string }[], today: string): string {
  const last = cycles.reduce(
    (latest, cycle) => (cycle.endsOn > latest ? cycle.endsOn : latest),
    '',
  );
  return last >= today ? addDays(last, 1) : today;
}

/** " · 3 added mid-cycle", or nothing when no work was added after its first day. */
export function addedLine(added: number): string {
  return added > 0 ? ` · ${added} added mid-cycle` : '';
}

const ORDINAL_ENDS = ['th', 'st', 'nd', 'rd'];

/** "2nd", "11th", "21st". */
function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? 'th' : (ORDINAL_ENDS[n % 10] ?? 'th')}`;
}

/**
 * "3rd cycle" on the card of an unfinished issue carried on from earlier
 * cycles; nothing in its first cycle, or once finished.
 */
export function carriedChip(carriedOver: number, finished: boolean): string | null {
  return carriedOver > 0 && !finished ? `${ordinal(carriedOver + 1)} cycle` : null;
}

type Span = { name: string; startsOn: string; endsOn: string };

/** The cycles sharing any day with `startsOn`..`endsOn`, both ends included. */
export function overlapping<T extends Span>(
  cycles: readonly T[],
  startsOn: string,
  endsOn: string,
): T[] {
  return cycles.filter((cycle) => cycle.startsOn <= endsOn && startsOn <= cycle.endsOn);
}

/** "Shares days with Two (Mon 23 Nov to Sun 6 Dec); they would run at the same time.", or null. */
export function overlapLine(found: readonly Span[]): string | null {
  if (found.length === 0) return null;
  const named = found
    .map((cycle) => `${cycle.name} (${dayLine(cycle.startsOn)} to ${dayLine(cycle.endsOn)})`)
    .join(' and ');
  return `Shares days with ${named}; they would run at the same time.`;
}
