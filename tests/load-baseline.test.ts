import { describe, expect, test } from 'bun:test';
import { ceilingOf } from '@robis/scripts/bench/baseline.ts';

/**
 * The load test's ceiling (E2): the median of three baseline runs plus a
 * margin from their own spread, so a noisy runner widens it, and never
 * less than half again, so a quiet one does not fail on a flicker.
 */

describe('the p99 ceiling', () => {
  test('three close runs: half again above the median', () => {
    expect(ceilingOf([20, 21, 22])).toBeCloseTo(21 * 1.5, 6);
  });

  test('three noisy runs: twice their spread above the median', () => {
    // Spread (40 - 20) / 30 = 2/3; twice that is 4/3.
    expect(ceilingOf([20, 30, 40])).toBeCloseTo(30 * (1 + 4 / 3), 6);
  });
});
