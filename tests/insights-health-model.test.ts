import { describe, expect, test } from 'bun:test';
import {
  acceptanceTile,
  edgeLabel,
  queueTile,
  readingTile,
} from '@robis/web/features/insights/health-model.ts';

/**
 * What the system health tiles say (Phase 6): a timing is known to within
 * a bucket and says so, an empty queue reads as clear rather than a zero
 * wait, and below the minimum sample a tile gives counts in words.
 */

const health = { hours: 24, minSample: 10 } as const;

describe('timings', () => {
  test('edges in the unit a person would use', () => {
    expect(edgeLabel(250)).toBe('250 ms');
    expect(edgeLabel(1_000)).toBe('1 second');
    expect(edgeLabel(2_500)).toBe('2.5 seconds');
    expect(edgeLabel(300_000)).toBe('5 minutes');
    expect(edgeLabel(21_600_000)).toBe('6 hours');
  });

  test('the median as the figure, the 95th percentile and the count beneath', () => {
    expect(
      readingTile({ count: 120, median: { withinMs: 50 }, p95: { withinMs: 1_000 } }, health),
    ).toEqual({
      figure: 'within 50 ms',
      line: 'Half within 50 ms, 19 in 20 within 1 second. From 120 timings in the last 24 hours.',
    });
  });

  test('a median and 95th percentile in one bucket are said once', () => {
    expect(
      readingTile({ count: 14, median: { withinMs: 10 }, p95: { withinMs: 10 } }, health).line,
    ).toBe('19 in 20 within 10 ms. From 14 timings in the last 24 hours.');
  });

  test('beyond the last bucket reads as over a day', () => {
    expect(
      readingTile({ count: 12, median: { withinMs: 900_000 }, p95: { withinMs: null } }, health)
        .line,
    ).toBe('Half within 15 minutes, 19 in 20 over a day. From 12 timings in the last 24 hours.');
  });

  test('below the minimum sample, the count in words and no figure', () => {
    expect(readingTile({ count: 1, median: null, p95: null }, health)).toEqual({
      figure: null,
      line: '1 timing in the last 24 hours. Figures appear once 10 have.',
    });
  });
});

describe('the job queue', () => {
  test('clear when nothing is due, with any dead letters named', () => {
    expect(queueTile({ due: 0, oldestDueSeconds: null, deadLetters: 0 })).toEqual({
      figure: 'Clear',
      line: 'Nothing waiting for a worker.',
    });
    expect(queueTile({ due: 0, oldestDueSeconds: null, deadLetters: 1 }).line).toBe(
      'Nothing waiting for a worker. 1 job used up its attempts and needs a look.',
    );
  });

  test('what is due and how long the oldest has waited', () => {
    expect(queueTile({ due: 3, oldestDueSeconds: 400, deadLetters: 2 })).toEqual({
      figure: '3 due',
      line: 'The oldest has waited 7 minutes. 2 jobs used up their attempts and need a look.',
    });
  });
});

describe('hints', () => {
  test('a rate from ten answers, counts in words before', () => {
    expect(acceptanceTile({ accepted: 8, dismissed: 4, rate: 8 / 12 }, 30, 10)).toEqual({
      figure: '67% used',
      line: '8 used and 4 set aside in the last 30 days.',
    });
    expect(acceptanceTile({ accepted: 3, dismissed: 0, rate: null }, 30, 10)).toEqual({
      figure: null,
      line: '3 answers in the last 30 days. A rate appears once 10 have.',
    });
  });
});
