import { describe, expect, test } from 'bun:test';
import { nextRunAfter, type RepeatRule } from '@robis/shared';

/**
 * When a repeating issue is filed next: at its hour on its own clock, on
 * the days its cadence names, always after the moment given, and at the
 * same wall time across a change of the clocks.
 */

const LONDON = 'Europe/London';
const rule = (over: Partial<RepeatRule>): RepeatRule => ({
  cadence: 'daily',
  weekday: null,
  monthDay: null,
  hour: 9,
  timeZone: LONDON,
  ...over,
});
// Tuesday 24 November 2026, 10:15 in London (GMT).
const NOW = new Date(Date.UTC(2026, 10, 24, 10, 15));

describe('the next run', () => {
  test('daily: tomorrow at nine when nine has passed, today when it has not', () => {
    expect(nextRunAfter(rule({}), NOW)).toEqual(new Date(Date.UTC(2026, 10, 25, 9)));
    expect(nextRunAfter(rule({ hour: 17 }), NOW)).toEqual(new Date(Date.UTC(2026, 10, 24, 17)));
  });

  test('weekdays skip the weekend', () => {
    const friday = new Date(Date.UTC(2026, 10, 27, 12));
    expect(nextRunAfter(rule({ cadence: 'weekdays' }), friday)).toEqual(
      new Date(Date.UTC(2026, 10, 30, 9)),
    );
  });

  test('weekly on its day, a week on when that day has gone', () => {
    expect(nextRunAfter(rule({ cadence: 'weekly', weekday: 1 }), NOW)).toEqual(
      new Date(Date.UTC(2026, 10, 30, 9)),
    );
    expect(nextRunAfter(rule({ cadence: 'weekly', weekday: 2 }), NOW)).toEqual(
      new Date(Date.UTC(2026, 11, 1, 9)),
    );
  });

  test('monthly on its day, next month when it has gone', () => {
    expect(nextRunAfter(rule({ cadence: 'monthly', monthDay: 1 }), NOW)).toEqual(
      new Date(Date.UTC(2026, 11, 1, 9)),
    );
    expect(nextRunAfter(rule({ cadence: 'monthly', monthDay: 28 }), NOW)).toEqual(
      new Date(Date.UTC(2026, 10, 28, 9)),
    );
  });

  test('nine o’clock stays nine o’clock on its own clock, across a change', () => {
    // The clocks in London go forward on 28 March 2027: nine is 08:00 UTC after it.
    const before = new Date(Date.UTC(2027, 2, 27, 10));
    expect(nextRunAfter(rule({}), before)).toEqual(new Date(Date.UTC(2027, 2, 28, 8)));
    // And in New York, nine is 14:00 UTC in winter.
    expect(nextRunAfter(rule({ timeZone: 'America/New_York' }), NOW)).toEqual(
      new Date(Date.UTC(2026, 10, 24, 14)),
    );
  });
});
