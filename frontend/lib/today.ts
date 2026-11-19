/** The home's Today: what "today" is here, and where a meeting stands against now. */

/** A meeting's join link shows from this long before it starts. */
const JOIN_LEAD_MS = 10 * 60_000;
/** Today, as this browser's clock and time zone see it. */
export function todayWindow(now: Date = new Date()): { from: Date; to: Date } {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { from, to };
}

/** Where a meeting stands against now: still to come, starting soon, under way, or over. */
export function meetingState(
  startsAt: Date,
  durationMinutes: number,
  now: Date,
): 'later' | 'soon' | 'now' | 'over' {
  const start = startsAt.getTime();
  const end = start + durationMinutes * 60_000;
  if (now.getTime() >= end) return 'over';
  if (now.getTime() >= start) return 'now';
  if (start - now.getTime() <= JOIN_LEAD_MS) return 'soon';
  return 'later';
}
