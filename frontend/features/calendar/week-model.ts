import { addDays, instantOf, type Wall, wallOf } from '@robis/shared';

/**
 * The week view's arithmetic (B8): pure, and in an explicit zone, so it is
 * tested across a clock change. The page passes the viewer's own zone; a
 * day that has 25 hours (or 23) is laid out as long as it really is.
 */

const MONDAY_FIRST = 6;

/** A calendar date, with the time of day at midnight. */
export type Day = Wall;

/** The Monday-to-Sunday week holding `anchor` in `zone`, and its window. */
export function weekOf(anchor: Date, zone: string) {
  const now = wallOf(anchor, zone);
  const weekday = new Date(Date.UTC(now.year, now.month - 1, now.day)).getUTCDay();
  const monday = addDays({ ...now, hour: 0, minute: 0 }, -((weekday + MONDAY_FIRST) % 7));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  return {
    days,
    from: instantOf(monday, zone),
    to: instantOf(addDays(monday, 7), zone),
    firstDay: dateKey(days[0]!),
    lastDay: dateKey(days[6]!),
  };
}

/** A day as YYYY-MM-DD, the way due dates are written. */
export function dateKey(day: Day): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${day.year}-${pad(day.month)}-${pad(day.day)}`;
}

/**
 * Where a span sits in a day column, as fractions of the day from its top:
 * clipped to the day, or null when it does not touch it.
 */
export function placeOn(day: Day, start: Date, minutes: number, zone: string) {
  const dayStart = instantOf(day, zone).getTime();
  const dayEnd = instantOf(addDays(day, 1), zone).getTime();
  const from = Math.max(start.getTime(), dayStart);
  const to = Math.min(start.getTime() + minutes * 60_000, dayEnd);
  if (to <= from) return null;
  const length = dayEnd - dayStart;
  return { top: (from - dayStart) / length, height: (to - from) / length };
}

/** Where an hour line sits in a day column, as a fraction from its top. */
export function hourAt(day: Day, hour: number, zone: string): number {
  const dayStart = instantOf(day, zone).getTime();
  const dayEnd = instantOf(addDays(day, 1), zone).getTime();
  return (instantOf({ ...day, hour }, zone).getTime() - dayStart) / (dayEnd - dayStart);
}

/**
 * Side-by-side lanes for spans that overlap: each gets the first free lane,
 * and every span in a cluster of overlaps shares the cluster's lane count.
 */
export function lanes(spans: readonly { start: number; end: number }[]) {
  const order = spans.map((span, index) => ({ ...span, index })).sort((a, b) => a.start - b.start);
  const placed = new Array<{ lane: number; lanes: number }>(spans.length);
  let cluster: { index: number; lane: number }[] = [];
  let clusterEnd = -Infinity;
  let laneEnds: number[] = [];
  const close = () => {
    for (const member of cluster)
      placed[member.index] = { lane: member.lane, lanes: laneEnds.length };
    cluster = [];
    laneEnds = [];
  };
  for (const span of order) {
    if (span.start >= clusterEnd) close();
    const free = laneEnds.findIndex((end) => end <= span.start);
    const lane = free === -1 ? laneEnds.length : free;
    laneEnds[lane] = span.end;
    cluster.push({ index: span.index, lane });
    clusterEnd = Math.max(clusterEnd, span.end);
  }
  close();
  return placed;
}

/** The anchor `weeks` weeks on (or back), for the week buttons. */
export function shiftWeeks(anchor: Date, weeks: number): Date {
  return new Date(anchor.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);
}

const dayName = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** "Mon 26 Oct", for a column's heading. */
export function dayLabel(day: Day): string {
  return dayName.format(new Date(Date.UTC(day.year, day.month - 1, day.day)));
}
