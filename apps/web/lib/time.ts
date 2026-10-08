/**
 * Formatting for timestamps the server sends as ISO strings.
 *
 * All of it is locale-aware through `Intl`, which means the output depends on
 * the reader's machine. That is correct for a time of day and wrong for
 * anything the server also renders, so these are only ever called from client
 * components after mount -- a server-rendered "2:05 PM" that hydrates to
 * "14:05" is a mismatch React will complain about, loudly and rightly.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const fullFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function formatTime(value: string | Date): string {
  return timeFormat.format(new Date(value));
}

export function formatDay(value: string | Date): string {
  return dayFormat.format(new Date(value));
}

/** The unambiguous form, for tooltips and anywhere precision matters. */
export function formatExact(value: string | Date): string {
  return fullFormat.format(new Date(value));
}

/**
 * "just now", "4m", "3h", "2d", then a date.
 *
 * Deliberately terse: these sit in the margin of a message list where a full
 * sentence would be read as content. Beyond a week the elapsed count stops
 * being meaningful and an actual date is more useful.
 */
export function formatRelative(value: string | Date, now: number = Date.now()): string {
  const then = new Date(value).getTime();
  const elapsed = now - then;

  // A clock skew between browser and server can put a just-written message
  // slightly in the future. "in -3 minutes" is nonsense; "just now" is true
  // enough.
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d`;

  return dayFormat.format(new Date(value));
}

/**
 * "in 2 hours", "tomorrow", "in 3 days" -- the forward-looking counterpart,
 * used by the meetings panel where the question is always how long until.
 */
export function formatUntil(value: string | Date, now: number = Date.now()): string {
  const start = new Date(value).getTime();
  const remaining = start - now;

  if (remaining <= 0) return 'now';
  if (remaining < MINUTE) return 'in under a minute';
  if (remaining < HOUR) return `in ${Math.round(remaining / MINUTE)} min`;
  if (remaining < DAY) {
    const hours = Math.round(remaining / HOUR);
    return hours === 1 ? 'in 1 hour' : `in ${hours} hours`;
  }

  const days = Math.round(remaining / DAY);
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

/** Whether two timestamps fall on the same calendar day, for date separators. */
export function isSameDay(a: string | Date, b: string | Date): boolean {
  const left = new Date(a);
  const right = new Date(b);

  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/**
 * "Today" and "Yesterday" beat a date for the two days that account for most
 * of what anybody scrolls through.
 */
export function formatDaySeparator(value: string | Date, now: Date = new Date()): string {
  if (isSameDay(value, now)) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(value, yesterday)) return 'Yesterday';

  return dayFormat.format(new Date(value));
}

/**
 * A `datetime-local` input's value for a Date.
 *
 * `toISOString` is UTC and would show the organiser a time they did not pick,
 * so the local parts are assembled by hand. There is no built-in formatter
 * for this: `Intl` is for display, and the input wants exactly
 * `YYYY-MM-DDTHH:mm`.
 */
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
