/**
 * Time zones and weekly repeats for meetings (B8), with no time-zone
 * library: the runtime's own Intl data answers what the offset is in a
 * zone at a moment, and everything else follows from that.
 *
 * Meetings are stored as an instant (UTC) plus the organiser's zone. A
 * weekly repeat keeps its wall-clock time in that zone, so a 09:00 meeting
 * in New York stays at 09:00 there when the clocks change, and its instant
 * moves by an hour; someone in a zone without daylight saving (Kolkata)
 * then sees it an hour later. Each occurrence is worked out here, used by
 * both the calendar feed and the week view.
 */

/** Weekly repeats only, and at most a year of them. */
export const MEETING_REPEAT_MAX = 52;

/** A named zone (Region/City), or UTC: not a bare offset like +05:30. */
const ZONE_NAME = /^(UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/;

/**
 * A zone's canonical IANA name as the runtime spells it (`europe/london`
 * becomes `Europe/London`), or null for anything that is not a named zone
 * it knows. Stored and compared in this form only.
 */
export function canonicalZone(zone: string): string | null {
  if (zone.length === 0 || zone.length > 64) return null;
  try {
    const canonical = new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions()
      .timeZone;
    return ZONE_NAME.test(canonical) ? canonical : null;
  } catch {
    return null;
  }
}

/** Whether the runtime knows `zone` as a named IANA time zone. */
export function isTimeZone(zone: string): boolean {
  return canonicalZone(zone) !== null;
}

/** A wall-clock reading: what a clock on the wall in some zone shows. */
export type Wall = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();
/** Far more zones than are in use; past it the cache starts again. */
const FORMATTERS_KEPT = 400;

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (!formatter) {
    if (formatters.size >= FORMATTERS_KEPT) formatters.clear();
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

/** What the wall clock in `zone` shows at `instant`. */
export function wallOf(instant: Date, zone: string): Wall & { second: number } {
  const parts = Object.fromEntries(
    formatterFor(zone)
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour!,
    minute: parts.minute!,
    second: parts.second!,
  };
}

/** How far ahead of UTC the wall clock in `zone` is at `instant`, in ms. */
export function offsetAt(instant: Date, zone: string): number {
  const wall = wallOf(instant, zone);
  const asIfUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  const whole = Math.floor(instant.getTime() / 1000) * 1000;
  return asIfUtc - whole;
}

/**
 * The instant at which the wall clock in `zone` shows `wall`. A reading
 * that happens twice (the hour the clocks go back) is its first; one that
 * never happens (the hour they go forward) is taken as the moment after
 * the gap, as calendars do.
 */
export function instantOf(wall: Wall, zone: string): Date {
  const asIfUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  // Two guesses settle it: the offset either side of any change is known
  // after the first, and the second lands on the right side.
  const first = asIfUtc - offsetAt(new Date(asIfUtc), zone);
  const second = asIfUtc - offsetAt(new Date(first), zone);
  if (second === first) {
    // Of two readings, the earlier: try an hour before.
    const earlier = second - 60 * 60 * 1000;
    const check = wallOf(new Date(earlier), zone);
    const same =
      check.year === wall.year &&
      check.month === wall.month &&
      check.day === wall.day &&
      check.hour === wall.hour &&
      check.minute === wall.minute;
    return new Date(same ? earlier : second);
  }
  // The guesses disagree only in a gap: the later one is after it.
  return new Date(Math.max(first, second));
}

/** The wall reading `days` calendar days after `wall`, at the same time of day. */
export function addDays(wall: Wall, days: number): Wall {
  const moved = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days));
  return {
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
    hour: wall.hour,
    minute: wall.minute,
  };
}

/** What the feed and the week view need to know of a meeting. */
export type Repeating = {
  startsAt: Date;
  durationMinutes: number;
  timeZone: string;
  /** How many weekly occurrences in all; null for a one-off. */
  repeatCount: number | null;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Clock changes move an occurrence by an hour at most; a day is ample. */
const SLACK_MS = 24 * 60 * 60 * 1000;

/** The start of the `week`-th occurrence (from 0), at the first's wall time. */
function occurrenceAt(meeting: Repeating, week: number): Date {
  if (week === 0) return meeting.startsAt;
  const wall = wallOf(meeting.startsAt, meeting.timeZone);
  // Wall readings are to the minute; any seconds the start has carry over.
  const seconds = meeting.startsAt.getTime() % 60_000;
  return new Date(instantOf(addDays(wall, week * 7), meeting.timeZone).getTime() + seconds);
}

/**
 * Every occurrence's start, in order: the first at `startsAt`, then the
 * same wall-clock time in the meeting's zone each week after.
 */
export function occurrences(meeting: Repeating): Date[] {
  const count = Math.max(1, meeting.repeatCount ?? 1);
  return Array.from({ length: count }, (_, week) => occurrenceAt(meeting, week));
}

/**
 * The occurrences that overlap `[from, to)`, working out only the weeks
 * that could: a year-long repeat read for one day costs a day's work.
 */
export function occurrencesBetween(meeting: Repeating, from: Date, to: Date): Date[] {
  const count = Math.max(1, meeting.repeatCount ?? 1);
  const length = meeting.durationMinutes * 60_000;
  const start = meeting.startsAt.getTime();
  const firstWeek = Math.max(0, Math.floor((from.getTime() - length - start - SLACK_MS) / WEEK_MS));
  const lastWeek = Math.min(count - 1, Math.ceil((to.getTime() - start + SLACK_MS) / WEEK_MS));
  const starts: Date[] = [];
  for (let week = firstWeek; week <= lastWeek; week++) {
    const at = occurrenceAt(meeting, week);
    if (at.getTime() < to.getTime() && at.getTime() + length > from.getTime()) starts.push(at);
  }
  return starts;
}
