import { describe, expect, test } from 'bun:test';
import {
  durationLabel,
  type ProjectFlow,
  sampleNote,
  spreadSentence,
  throughputLabel,
  untimedNote,
  weekEnding,
  weekLines,
} from '@robis/web/features/insights/flow-model.ts';

/**
 * What the Insights page says (Phase 6): figures in the unit a person would
 * use, the counts behind each, and below the minimum sample, counts in
 * words instead of a figure.
 */

const HOUR = 3600;
const DAY = 24 * HOUR;
const flow = { weeks: 12, minSample: 10 } as const;
const cycle = {
  medianSeconds: 5.5 * DAY,
  p25Seconds: 3.25 * DAY,
  p75Seconds: 7.75 * DAY,
  p90Seconds: 9.1 * DAY,
};
const project = (fields: Partial<ProjectFlow>): ProjectFlow => ({
  id: '00000000-0000-4000-8000-000000000001',
  key: 'WEB',
  name: 'Web App',
  finished: 12,
  measured: 12,
  throughput: new Array(12).fill(1),
  cycleTime: cycle,
  ...fields,
});

describe('durations', () => {
  test('in hours under two days, tenths of a day under ten, whole days beyond', () => {
    expect(durationLabel(20 * 60)).toBe('under an hour');
    expect(durationLabel(HOUR)).toBe('1 hour');
    expect(durationLabel(30 * HOUR)).toBe('30 hours');
    expect(durationLabel(2 * DAY)).toBe('2 days');
    expect(durationLabel(3.25 * DAY)).toBe('3.3 days');
    expect(durationLabel(12.4 * DAY)).toBe('12 days');
  });

  test('short spans never read as "between under an hour"', () => {
    expect(spreadSentence({ ...cycle, p25Seconds: 600, p75Seconds: 3 * HOUR })).toBe(
      'Three in four took under 3 hours; one in ten took over 9.1 days.',
    );
    expect(
      spreadSentence({ medianSeconds: 300, p25Seconds: 60, p75Seconds: 900, p90Seconds: 1800 }),
    ).toBe('Nine in ten took under an hour.');
  });

  test('the spread in one sentence', () => {
    expect(spreadSentence(cycle)).toBe(
      'Half took between 3.3 days and 7.8 days; one in ten took over 9.1 days.',
    );
  });
});

describe('below the minimum sample', () => {
  test('nothing finished says so', () => {
    expect(
      sampleNote(project({ finished: 0, measured: 0, throughput: null, cycleTime: null }), flow),
    ).toBe('Nothing finished in the last 12 weeks.');
  });

  test('too few finished gives the number needed; the card header has the count', () => {
    expect(
      sampleNote(project({ finished: 3, measured: 3, throughput: null, cycleTime: null }), flow),
    ).toBe(
      'Too few to chart yet. Figures appear once 10 have finished in the last 12 weeks, since a handful is a guess.',
    );
  });

  test('enough finished but too few timed explains the missing cycle time', () => {
    expect(sampleNote(project({ finished: 14, measured: 6, cycleTime: null }), flow)).toBe(
      'Only 6 of 14 have a recorded start. A cycle time needs 10.',
    );
  });

  test('with every figure there is nothing to explain', () => {
    expect(sampleNote(project({}), flow)).toBeNull();
  });
});

describe('the smaller print', () => {
  test('untimed issues are named when some were timed', () => {
    expect(untimedNote(project({ finished: 11, measured: 10 }))).toBe(
      '1 issue never moved into work, so it is counted but not timed.',
    );
    expect(untimedNote(project({ finished: 13, measured: 10 }))).toBe(
      '3 issues never moved into work, so they are counted but not timed.',
    );
    expect(untimedNote(project({}))).toBeNull();
  });

  test('a week is named by its last day; the bars by their total', () => {
    expect(weekEnding('2026-11-01T12:00:00.000Z', 0)).toBe('8 Nov');
    expect(weekLines([2, 0], '2026-11-01T12:00:00.000Z')).toEqual([
      'Week to 8 Nov: 2 finished',
      'Week to 15 Nov: 0 finished',
    ]);
    expect(throughputLabel([0, 2, 1, 3])).toBe(
      '6 issues finished over 4 weeks, 3 in the last seven days',
    );
  });
});
