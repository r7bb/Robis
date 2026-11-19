import { describe, expect, test } from 'bun:test';
import { meetingState, todayWindow } from '@robis/web/lib/today.ts';

describe('today on the home', () => {
  test('runs from this browser’s midnight to the next', () => {
    const { from, to } = todayWindow(new Date(2026, 10, 19, 15, 42));
    expect(from).toEqual(new Date(2026, 10, 19));
    expect(to).toEqual(new Date(2026, 10, 20));
  });

  test('crosses a month and a year end', () => {
    expect(todayWindow(new Date(2026, 11, 31, 23, 59)).to).toEqual(new Date(2027, 0, 1));
  });

  test('a meeting is later, soon in its last ten minutes, under way, then over when it ends', () => {
    const start = new Date(2026, 10, 19, 15, 0);
    const minutes = (n: number) => new Date(start.getTime() + n * 60_000);
    expect(meetingState(start, 30, minutes(-30))).toBe('later');
    expect(meetingState(start, 30, minutes(-10))).toBe('soon');
    expect(meetingState(start, 30, minutes(0))).toBe('now');
    expect(meetingState(start, 30, minutes(29))).toBe('now');
    expect(meetingState(start, 30, minutes(30))).toBe('over');
    expect(meetingState(start, 30, minutes(90))).toBe('over');
  });
});
