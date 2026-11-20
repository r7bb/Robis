/** The start of this week, Monday 00:00 UTC: when the weekly check-in comes round again. */
export function weekStart(now: Date = new Date()): Date {
  const day = now.getUTCDay();
  const sinceMonday = (day + 6) % 7;
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - sinceMonday),
  );
}
