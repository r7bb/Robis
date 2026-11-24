import { evenPace } from '@robis/shared';

/** Days in a cycle, both ends counted. */
export function cycleLength(startsOn: string, endsOn: string): number {
  return (
    Math.round(
      (Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`)) / 86_400_000,
    ) + 1
  );
}

/** An even pace's count, said as a person would: whole, or to one place. */
const said = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * The chart in a sentence, for its accessible name and its caption:
 * "3 of 8 done after day 5 of 14; an even pace would have 2.9".
 */
export function burnUpLine(done: readonly number[], planned: number, days: number): string {
  if (done.length === 0) return `Starts soon; ${planned} planned over ${days} days.`;
  const day = done.length;
  const pace = evenPace(planned, days)[day - 1] ?? planned;
  const now = done[day - 1] ?? 0;
  return `${now} of ${planned} done after day ${day} of ${days}; an even pace would have ${said(pace)}.`;
}
