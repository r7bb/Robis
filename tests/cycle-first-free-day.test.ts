import { describe, expect, test } from 'bun:test';
import { firstFreeDay } from '@robis/web/features/cycles/cycle-days.ts';

/**
 * Where a cycle Sapha plans begins: today when no cycle runs now or later,
 * else the day after the last one planned, so it never lands on top of one.
 */

const TODAY = '2026-11-25';
const ends = (endsOn: string) => ({ endsOn });

describe('the first day no cycle covers', () => {
  test('today, when the board has no cycles or only past ones', () => {
    expect(firstFreeDay([], TODAY)).toBe(TODAY);
    expect(firstFreeDay([ends('2026-11-01'), ends('2026-11-24')], TODAY)).toBe(TODAY);
  });

  test('the day after the cycle running now', () => {
    expect(firstFreeDay([ends('2026-11-24'), ends('2026-12-02')], TODAY)).toBe('2026-12-03');
  });

  test('the day after one ending today', () => {
    expect(firstFreeDay([ends(TODAY)], TODAY)).toBe('2026-11-26');
  });

  test('after the last one planned, whatever order they come in', () => {
    expect(firstFreeDay([ends('2027-01-10'), ends('2026-12-02')], TODAY)).toBe('2027-01-11');
  });
});
