import { addDays, instantOf, wallOf } from './calendar.ts';

/**
 * Repeating issues: filed for a team on a schedule, at an hour on the
 * clock of whoever set it up, on the days the cadence names. This works out
 * when the next one is due; the API files it then.
 */

export const REPEAT_CADENCES = ['daily', 'weekdays', 'weekly', 'monthly'] as const;
export type RepeatCadence = (typeof REPEAT_CADENCES)[number];

/** The latest day of a month a monthly repeat may name: every month has it. */
export const REPEAT_MONTH_DAY_MAX = 28;
/** Repeats a project may have. */
export const REPEATS_PER_PROJECT = 25;

export type RepeatRule = {
  cadence: RepeatCadence;
  /** For weekly: 0 Sunday to 6 Saturday. */
  weekday: number | null;
  /** For monthly: 1 to 28. */
  monthDay: number | null;
  /** 0 to 23, on `timeZone`'s clock. */
  hour: number;
  timeZone: string;
};

/** Days looked ahead: a monthly repeat is always found within two months. */
const DAYS_AHEAD = 62;

function onRuleDay(rule: RepeatRule, wall: { year: number; month: number; day: number }) {
  const weekday = new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();
  switch (rule.cadence) {
    case 'daily':
      return true;
    case 'weekdays':
      return weekday >= 1 && weekday <= 5;
    case 'weekly':
      return weekday === rule.weekday;
    case 'monthly':
      return wall.day === rule.monthDay;
  }
}

/** The first time after `after` the rule falls due, on its own clock. */
export function nextRunAfter(rule: RepeatRule, after: Date): Date {
  const today = wallOf(after, rule.timeZone);
  for (let offset = 0; offset <= DAYS_AHEAD; offset++) {
    const day = addDays({ ...today, hour: rule.hour, minute: 0 }, offset);
    if (!onRuleDay(rule, day)) continue;
    const at = instantOf({ ...day, hour: rule.hour, minute: 0 }, rule.timeZone);
    if (at.getTime() > after.getTime()) return at;
  }
  throw new Error('nextRunAfter: no day in range matches the rule');
}
