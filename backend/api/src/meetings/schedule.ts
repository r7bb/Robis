import { occurrences, type Repeating } from '@robis/shared';

/**
 * Where a meeting stands in time (B8): its last start, kept on the row so
 * the lists can filter on it, and the next occurrence to show. Both from
 * the shared occurrence rules, so the lists, the feed and the week view
 * agree on every repeat.
 */

/** When the last occurrence starts. */
export function lastStartOf(meeting: Repeating): Date {
  return occurrences(meeting).at(-1)!;
}

/** The first occurrence starting at or after `cutoff`, or the last one. */
function nextStartOf(meeting: Repeating, cutoff: Date): Date {
  const all = occurrences(meeting);
  return all.find((start) => start.getTime() >= cutoff.getTime()) ?? all.at(-1)!;
}

/** A row with its next occurrence beside it. */
export function withNext<T extends Repeating>(row: T, cutoff: Date): T & { nextStartsAt: Date } {
  return { ...row, nextStartsAt: nextStartOf(row, cutoff) };
}
