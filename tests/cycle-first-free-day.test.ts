import { describe, expect, test } from 'bun:test';
import {
  addedLine,
  carriedChip,
  firstFreeDay,
  overlapLine,
  overlapping,
} from '@robis/web/features/cycles/cycle-days.ts';
import { setFormatLocale } from '@robis/web/lib/i18n/format.ts';

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

describe('work added mid-cycle, as said beside the count', () => {
  test('nothing when none was added, else how many', () => {
    expect(addedLine(0)).toBe('');
    expect(addedLine(3)).toBe(' · 3 added mid-cycle');
  });
});

describe('how long an unfinished issue has been carried, as its card says', () => {
  test('nothing in its first cycle or once finished, else which cycle it is in', () => {
    expect(carriedChip(0, false)).toBeNull();
    expect(carriedChip(2, true)).toBeNull();
    expect(carriedChip(1, false)).toBe('2nd cycle');
    expect(carriedChip(2, false)).toBe('3rd cycle');
    expect(carriedChip(3, false)).toBe('4th cycle');
    expect(carriedChip(10, false)).toBe('11th cycle');
    expect(carriedChip(20, false)).toBe('21st cycle');
  });
});

describe('days that overlap a cycle already planned', () => {
  const planned = [
    { name: 'One', startsOn: '2026-11-09', endsOn: '2026-11-22' },
    { name: 'Two', startsOn: '2026-11-23', endsOn: '2026-12-06' },
  ];

  test('the cycles sharing any day, ends included', () => {
    expect(overlapping(planned, '2026-12-07', '2026-12-20')).toEqual([]);
    expect(overlapping(planned, '2026-12-06', '2026-12-20').map((c) => c.name)).toEqual(['Two']);
    expect(overlapping(planned, '2026-11-20', '2026-11-24').map((c) => c.name)).toEqual([
      'One',
      'Two',
    ]);
  });

  test('said with each one’s days, or nothing when none overlap', () => {
    setFormatLocale('en', ['en-GB']);
    expect(overlapLine([])).toBeNull();
    expect(overlapLine([planned[1]!])).toBe(
      'Shares days with Two (Mon 23 Nov to Sun 6 Dec); they would run at the same time.',
    );
    setFormatLocale('en', []);
  });
});
