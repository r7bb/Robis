import { describe, expect, test } from 'bun:test';
import { parseWhen, SNOOZE_PRESETS } from '@robis/shared';

/**
 * "When" in plain words (snooze and reminders): what a person types, read
 * in their own clock, always later than now, or nothing at all.
 */

// Tuesday 24 November 2026, 10:15 local time.
const NOW = new Date(2026, 10, 24, 10, 15);
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute);

describe('plain words for a time', () => {
  test('a span from now', () => {
    expect(parseWhen('in 20 minutes', NOW)).toEqual(new Date(NOW.getTime() + 20 * 60_000));
    expect(parseWhen('in 2 hours', NOW)).toEqual(new Date(NOW.getTime() + 2 * 3_600_000));
    expect(parseWhen('in an hour', NOW)).toEqual(new Date(NOW.getTime() + 3_600_000));
    expect(parseWhen('in 3 days', NOW)).toEqual(at(27, 10, 15));
    expect(parseWhen('in a week', NOW)).toEqual(at(1 + 30, 10, 15));
    expect(parseWhen('in 90m', NOW)).toEqual(new Date(NOW.getTime() + 90 * 60_000));
  });

  test('tomorrow, with or without a time', () => {
    expect(parseWhen('tomorrow', NOW)).toEqual(at(25, 9));
    expect(parseWhen('Tomorrow 3pm', NOW)).toEqual(at(25, 15));
    expect(parseWhen('tomorrow at 17:30', NOW)).toEqual(at(25, 17, 30));
    expect(parseWhen('tomorrow noon', NOW)).toEqual(at(25, 12));
  });

  test('a weekday is the next one, never today', () => {
    expect(parseWhen('friday', NOW)).toEqual(at(27, 9));
    expect(parseWhen('fri 2:30pm', NOW)).toEqual(at(27, 14, 30));
    expect(parseWhen('tuesday', NOW)).toEqual(at(1 + 30, 9));
    expect(parseWhen('monday 8am', NOW)).toEqual(at(30, 8));
  });

  test('a time alone is today if still ahead, else tomorrow', () => {
    expect(parseWhen('4pm', NOW)).toEqual(at(24, 16));
    expect(parseWhen('at 9', NOW)).toEqual(at(25, 9));
    expect(parseWhen('today 11:45', NOW)).toEqual(at(24, 11, 45));
  });

  test('later, tonight and next week', () => {
    expect(parseWhen('later', NOW)).toEqual(at(24, 13, 15));
    expect(parseWhen('tonight', NOW)).toEqual(at(24, 19));
    expect(parseWhen('next week', NOW)).toEqual(at(30, 9));
  });

  test('anything past, impossible or unknown is nothing', () => {
    expect(parseWhen('today 8am', NOW)).toBeNull();
    expect(parseWhen('25pm', NOW)).toBeNull();
    expect(parseWhen('9:75', NOW)).toBeNull();
    expect(parseWhen('in 0 hours', NOW)).toBeNull();
    expect(parseWhen('whenever', NOW)).toBeNull();
    expect(parseWhen('', NOW)).toBeNull();
    expect(parseWhen('in 9999 days', NOW)).toBeNull();
  });

  test('the presets are three, each later than now', () => {
    const presets = SNOOZE_PRESETS.map((preset) => preset.at(NOW));
    expect(SNOOZE_PRESETS.map((preset) => preset.label)).toEqual([
      'Later today',
      'Tomorrow',
      'Next week',
    ]);
    expect(presets).toEqual([at(24, 13, 15), at(25, 9), at(30, 9)]);
  });

  test('late in the evening, every preset is still ahead', () => {
    const late = new Date(2026, 10, 24, 22, 0);
    expect(SNOOZE_PRESETS.every((preset) => preset.at(late).getTime() > late.getTime())).toBe(true);
  });
});
