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
