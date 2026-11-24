/**
 * "When" in plain words, for snoozing a notification or being reminded:
 * "in 2 hours", "tomorrow 3pm", "friday", "next week". Read on the clock of
 * whoever types it (the browser's), and always later than now; anything
 * past, impossible or not understood is null, so nothing is ever set for a
 * time nobody meant. The server checks only that a time is ahead and near.
 */

/** How far ahead a snooze or a reminder may be. */
export const SNOOZE_MAX_DAYS = 90;

const MINUTE = 60_000;
/** The hour a day named without a time means. */
const MORNING = 9;
/** "Later": a few hours on. */
const LATER_HOURS = 3;
const TONIGHT = 19;

const UNIT_MINUTES: Record<string, number> = {
  m: 1,
  min: 1,
  mins: 1,
  minute: 1,
  minutes: 1,
  h: 60,
  hr: 60,
  hrs: 60,
  hour: 60,
  hours: 60,
  d: 1440,
  day: 1440,
  days: 1440,
  w: 10080,
  week: 10080,
  weeks: 10080,
};

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
/** Shortest a weekday may be typed: "fri". */
const WEEKDAY_MIN = 3;

type ClockTime = { hour: number; minute: number };

/** "9", "9am", "9:30 pm", "17:30", "noon", "midnight"; null if not a time. */
function clockTime(text: string): ClockTime | null {
  const word = text.replace(/^at\s+/, '').trim();
  if (word === 'noon') return { hour: 12, minute: 0 };
  if (word === 'midnight') return { hour: 0, minute: 0 };
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(word);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const half = match[3];
  if (minute > 59) return null;
  if (half) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (half === 'pm' ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  return { hour, minute };
}

/** The same calendar day as `day`, `offset` days on, at a clock time. */
function onDay(day: Date, offset: number, time: ClockTime): Date {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate() + offset,
    time.hour,
    time.minute,
  );
}

/** An optional time after a day word: none means the morning. */
function timeOrMorning(rest: string): ClockTime | null {
  return rest ? clockTime(rest) : { hour: MORNING, minute: 0 };
}

function span(text: string, now: Date): Date | null {
  const match = /^in\s+(an?|\d{1,5})\s*([a-z]+)$/.exec(text);
  if (!match) return null;
  const count = match[1] === 'a' || match[1] === 'an' ? 1 : Number(match[1]);
  const unit = UNIT_MINUTES[match[2]!];
  if (!unit || count < 1) return null;
  return new Date(now.getTime() + count * unit * MINUTE);
}

function weekday(text: string, now: Date): Date | null {
  const match = /^([a-z]+)\s*(.*)$/.exec(text);
  if (!match) return null;
  const typed = match[1]!;
  // "fri", "friday" and the like; not a word that merely starts the same.
  const index = WEEKDAYS.findIndex((day) => typed.length >= WEEKDAY_MIN && day.startsWith(typed));
  if (index < 0) return null;
  const time = timeOrMorning(match[2]!.trim());
  if (!time) return null;
  const ahead = (index - now.getDay() + 7) % 7 || 7;
  return onDay(now, ahead, time);
}

/** Every reading but the weekday: words that name a day, or a time alone. */
function dayWords(text: string, now: Date): Date | null {
  if (text === 'later' || text === 'later today') {
    return new Date(now.getTime() + LATER_HOURS * 60 * MINUTE);
  }
  if (text === 'tonight') return onDay(now, 0, { hour: TONIGHT, minute: 0 });
  if (text === 'next week') {
    const toMonday = (8 - now.getDay()) % 7 || 7;
    return onDay(now, toMonday, { hour: MORNING, minute: 0 });
  }
  const tomorrow = /^tomorrow\s*(.*)$/.exec(text);
  if (tomorrow) {
    const time = timeOrMorning(tomorrow[1]!.trim());
    return time ? onDay(now, 1, time) : null;
  }
  const today = /^today\s+(.+)$/.exec(text);
  if (today) {
    const time = clockTime(today[1]!);
    return time ? onDay(now, 0, time) : null;
  }
  const time = clockTime(text);
  if (!time) return null;
  const sameDay = onDay(now, 0, time);
  return sameDay > now ? sameDay : onDay(now, 1, time);
}

/** Whether a moment may be snoozed or reminded until: ahead, and not too far. */
export function isWithinSnooze(when: Date, now: Date = new Date()): boolean {
  const ahead = when.getTime() - now.getTime();
  return ahead > 0 && ahead <= SNOOZE_MAX_DAYS * 1440 * MINUTE;
}

/** What `text` means as a moment after `now`, or null. */
export function parseWhen(text: string, now: Date = new Date()): Date | null {
  const words = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!words) return null;
  const when = span(words, now) ?? weekday(words, now) ?? dayWords(words, now);
  return when && isWithinSnooze(when, now) ? when : null;
}

/** The choices offered before anything is typed. */
export const SNOOZE_PRESETS: readonly { label: string; at: (now: Date) => Date }[] = [
  { label: 'Later today', at: (now) => new Date(now.getTime() + LATER_HOURS * 60 * MINUTE) },
  { label: 'Tomorrow', at: (now) => onDay(now, 1, { hour: MORNING, minute: 0 }) },
  {
    label: 'Next week',
    at: (now) => onDay(now, (8 - now.getDay()) % 7 || 7, { hour: MORNING, minute: 0 }),
  },
];
