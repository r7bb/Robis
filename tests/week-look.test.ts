import { describe, expect, test } from 'bun:test';
import {
  isoWeek,
  isWeekend,
  nowOn,
  sameDay,
  toneIndex,
  wallToday,
  weekOf,
  weekTitle,
} from '@robis/web/features/calendar/week-model.ts';

/**
 * The calendar's look (the redesign): its title, the week number, the line
 * for now, weekends, and each meeting keeping its colour.
 */

const LONDON = 'Europe/London';
const day = (year: number, month: number, d: number) => ({
  year,
  month,
  day: d,
  hour: 0,
  minute: 0,
});

describe('the week title', () => {
  test('names the month when the week sits in one', () => {
    const { days } = weekOf(new Date('2026-11-18T12:00:00Z'), LONDON);
    expect(weekTitle(days)).toBe('November 2026');
  });

  test('names both months across a month end, and both years across a year end', () => {
    expect(weekTitle(weekOf(new Date('2026-12-01T12:00:00Z'), LONDON).days)).toBe(
      'Nov to Dec 2026',
    );
    expect(weekTitle(weekOf(new Date('2026-12-31T12:00:00Z'), LONDON).days)).toBe(
      'Dec 2026 to Jan 2027',
    );
  });
});

describe('the week number', () => {
  test('follows ISO weeks, including the 53rd and the turn of the year', () => {
    expect(isoWeek(day(2026, 11, 23))).toBe(48);
    expect(isoWeek(day(2026, 1, 1))).toBe(1);
    expect(isoWeek(day(2026, 12, 31))).toBe(53);
    expect(isoWeek(day(2027, 1, 3))).toBe(53);
    expect(isoWeek(day(2027, 1, 4))).toBe(1);
  });
});

describe('the line for now', () => {
  test('sits at the right height on today and nowhere else', () => {
    const today = day(2026, 11, 23);
    expect(nowOn(today, new Date('2026-11-23T12:00:00Z'), LONDON)).toBeCloseTo(0.5);
    expect(nowOn(day(2026, 11, 24), new Date('2026-11-23T12:00:00Z'), LONDON)).toBeNull();
  });

  test('accounts for a 25 hour day at the clock change', () => {
    // 25 October 2026 in London has 25 hours; noon UTC is 12.5 hours in.
    expect(nowOn(day(2026, 10, 25), new Date('2026-10-25T12:00:00Z'), LONDON)).toBeCloseTo(13 / 25);
  });
});

describe('days and colours', () => {
  test('Saturday and Sunday are the weekend', () => {
    expect(isWeekend(day(2026, 11, 28))).toBe(true);
    expect(isWeekend(day(2026, 11, 29))).toBe(true);
    expect(isWeekend(day(2026, 11, 27))).toBe(false);
    expect(sameDay(day(2026, 11, 27), { ...day(2026, 11, 27), hour: 9 })).toBe(true);
  });

  test('a meeting keeps the same colour slot, within range', () => {
    const slot = toneIndex('3b1f0d4e-meeting', 5);
    expect(toneIndex('3b1f0d4e-meeting', 5)).toBe(slot);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slot).toBeLessThan(5);
  });
});

describe('today', () => {
  test('is the date in the viewer’s zone, not in UTC', () => {
    // 23:30 UTC on the 23rd is already the 24th in Tokyo.
    const late = new Date('2026-11-23T23:30:00Z');
    expect(wallToday(late, 'Asia/Tokyo')).toEqual(day(2026, 11, 24));
    expect(wallToday(late, LONDON)).toEqual(day(2026, 11, 23));
  });
});
