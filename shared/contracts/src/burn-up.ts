/**
 * A cycle's burn-up (how much of it is done by the end of each day) from
 * when its issues were finished, counted on the asker's calendar. Days are
 * `YYYY-MM-DD`, which sort as the calendar does.
 */

const DAY_MS = 86_400_000;

const nextDay = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);

/** The days from `from` to `to`, both included. */
function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = nextDay(day)) days.push(day);
  return days;
}

/**
 * Done by the end of each of the cycle's days through today (or its last
 * day, if that is sooner): work finished before it began counts from its
 * first day; work finished after it ended does not count.
 */
export function burnUp(cycle: {
  startsOn: string;
  endsOn: string;
  today: string;
  finished: readonly { day: string; count: number }[];
}): number[] {
  if (cycle.today < cycle.startsOn) return [];
  const last = cycle.today < cycle.endsOn ? cycle.today : cycle.endsOn;
  return daysBetween(cycle.startsOn, last).map((day) =>
    cycle.finished.filter((f) => f.day <= day).reduce((sum, f) => sum + f.count, 0),
  );
}

/** Where an even pace would have the work by the end of each of `days` days. */
export function evenPace(planned: number, days: number): number[] {
  return Array.from({ length: days }, (_, i) => (planned * (i + 1)) / days);
}
