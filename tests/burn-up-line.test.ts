import { describe, expect, test } from 'bun:test';
import { burnUpLine, cycleLength } from '@robis/web/features/cycles/burn-up-model.ts';

/** How a cycle's burn-up is said, for its name and caption. */

describe('the burn-up in words', () => {
  test('done so far, the day, and where an even pace would be', () => {
    expect(burnUpLine([0, 1, 3], 7, 14)).toBe(
      '3 of 7 done after day 3 of 14; an even pace would have 1.5.',
    );
    expect(burnUpLine([2, 4], 8, 4)).toBe(
      '4 of 8 done after day 2 of 4; an even pace would have 4.',
    );
    expect(burnUpLine([], 5, 14)).toBe('Starts soon; 5 planned over 14 days.');
  });

  test('a cycle’s length counts both ends', () => {
    expect(cycleLength('2026-11-23', '2026-12-06')).toBe(14);
    expect(cycleLength('2026-11-24', '2026-11-24')).toBe(1);
  });
});
