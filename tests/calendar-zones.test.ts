import { describe, expect, test } from 'bun:test';
import {
  instantOf,
  isTimeZone,
  occurrences,
  occurrencesBetween,
  offsetAt,
  wallOf,
} from '@robis/shared';

/**
 * Time zones and weekly repeats (B8), against answers worked by hand. In
 * 2026 the United States leaves daylight saving on Sunday 1 November at
 * 02:00 local (06:00 UTC); Kolkata keeps +05:30 all year.
 */

const NY = 'America/New_York';
const KOLKATA = 'Asia/Kolkata';
const iso = (date: Date) => date.toISOString();
/** "HH:MM" as a viewer in `zone` reads it. */
const clock = (date: Date, zone: string) => {
  const wall = wallOf(date, zone);
  return `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`;
};

describe('zones', () => {
  test('known zones are known; anything else is not', () => {
    expect(isTimeZone(NY)).toBe(true);
    expect(isTimeZone(KOLKATA)).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isTimeZone('')).toBe(false);
  });

  test('offsets either side of the November change, and Kolkata unmoved', () => {
    expect(offsetAt(new Date('2026-10-31T12:00:00Z'), NY)).toBe(-4 * 3_600_000);
    expect(offsetAt(new Date('2026-11-02T12:00:00Z'), NY)).toBe(-5 * 3_600_000);
    expect(offsetAt(new Date('2026-10-31T12:00:00Z'), KOLKATA)).toBe(5.5 * 3_600_000);
    expect(offsetAt(new Date('2026-11-02T12:00:00Z'), KOLKATA)).toBe(5.5 * 3_600_000);
  });

  test('a wall reading becomes its instant, either side of the change', () => {
    const wall = (day: number, hour: number, minute = 0) => ({
      year: 2026,
      month: 11,
      day,
      hour,
      minute,
    });
    expect(iso(instantOf({ ...wall(29, 9), month: 10 }, NY))).toBe('2026-10-29T13:00:00.000Z');
    expect(iso(instantOf(wall(5, 9), NY))).toBe('2026-11-05T14:00:00.000Z');
    expect(iso(instantOf(wall(5, 19), KOLKATA))).toBe('2026-11-05T13:30:00.000Z');
  });

  test('the hour that happens twice is its first; the hour that never happens, after the gap', () => {
    // 01:30 on 1 November happens at 05:30 UTC (daylight time) and 06:30 (standard).
    expect(iso(instantOf({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, NY))).toBe(
      '2026-11-01T05:30:00.000Z',
    );
    // 02:30 on 8 March 2026 never happens; 03:30 daylight time does.
    expect(iso(instantOf({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, NY))).toBe(
      '2026-03-08T07:30:00.000Z',
    );
  });
});

describe('a weekly meeting across the November change', () => {
  test('organised in New York at 09:00: the same there, an hour later in Kolkata', () => {
    const starts = occurrences({
      startsAt: new Date('2026-10-22T13:00:00Z'),
      durationMinutes: 30,
      timeZone: NY,
      repeatCount: 3,
    });
    expect(starts.map(iso)).toEqual([
      '2026-10-22T13:00:00.000Z',
      '2026-10-29T13:00:00.000Z',
      '2026-11-05T14:00:00.000Z',
    ]);
    expect(starts.map((start) => clock(start, NY))).toEqual(['09:00', '09:00', '09:00']);
    expect(starts.map((start) => clock(start, KOLKATA))).toEqual(['18:30', '18:30', '19:30']);
  });

  test('organised in Kolkata at 19:00: fixed there, an hour earlier in New York', () => {
    const starts = occurrences({
      startsAt: new Date('2026-10-22T13:30:00Z'),
      durationMinutes: 60,
      timeZone: KOLKATA,
      repeatCount: 3,
    });
    expect(starts.map((start) => clock(start, KOLKATA))).toEqual(['19:00', '19:00', '19:00']);
    expect(starts.map((start) => clock(start, NY))).toEqual(['09:30', '09:30', '08:30']);
  });

  test('a one-off is just itself, and a window keeps the occurrences it overlaps', () => {
    const once = {
      startsAt: new Date('2026-11-05T14:00:00Z'),
      durationMinutes: 30,
      timeZone: NY,
      repeatCount: null,
    };
    expect(occurrences(once).map(iso)).toEqual(['2026-11-05T14:00:00.000Z']);
    const weekly = { ...once, startsAt: new Date('2026-10-22T13:00:00Z'), repeatCount: 3 };
    const window = occurrencesBetween(
      weekly,
      new Date('2026-10-29T13:15:00Z'),
      new Date('2026-11-06T00:00:00Z'),
    );
    // The 29 October one is still under way at 13:15; the 22 October one is long over.
    expect(window.map(iso)).toEqual(['2026-10-29T13:00:00.000Z', '2026-11-05T14:00:00.000Z']);
  });
});
