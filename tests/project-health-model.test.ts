import { describe, expect, test } from 'bun:test';
import {
  factsOf,
  type ProjectHealth,
  progressOf,
} from '@robis/web/features/feed/project-health-model.ts';

/** What a project health card says (Phase 2c): the facts behind its state, in words. */

const NOW = Date.parse('2026-11-20T12:00:00Z');
const base: ProjectHealth = {
  id: '00000000-0000-4000-8000-000000000001',
  key: 'WEB',
  name: 'Web App',
  state: 'on_track',
  open: 4,
  done: 6,
  doneRecently: 2,
  openedRecently: 1,
  overdue: 0,
  urgent: 0,
  lastMovedAt: new Date(NOW).toISOString(),
};

describe('a health card', () => {
  test('on track: what was done this week, and what is open', () => {
    expect(factsOf(base, NOW)).toEqual(['2 done this week', '4 open']);
  });

  test('needs a look: what is overdue and urgent comes first, three facts at most', () => {
    expect(factsOf({ ...base, state: 'needs_a_look', overdue: 2, urgent: 1 }, NOW)).toEqual([
      '2 overdue',
      '1 urgent',
      '2 done this week',
    ]);
  });

  test('quiet: how long nothing has moved', () => {
    const quiet = {
      ...base,
      state: 'quiet' as const,
      doneRecently: 0,
      lastMovedAt: new Date(NOW - 15 * 86_400_000).toISOString(),
    };
    expect(factsOf(quiet, NOW)).toEqual(['nothing moved in 15 days', '4 open']);
  });

  test('finished: every issue done, and progress is done out of what was not cancelled', () => {
    const finished = { ...base, state: 'finished' as const, open: 0, done: 1, doneRecently: 1 };
    expect(factsOf(finished, NOW)).toEqual(['1 done this week', 'all 1 issue done']);
    expect(progressOf(finished)).toBe(100);
    expect(progressOf(base)).toBe(60);
    expect(progressOf({ open: 0, done: 0 })).toBe(0);
  });
});
