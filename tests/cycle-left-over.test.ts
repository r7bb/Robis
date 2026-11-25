import { describe, expect, test } from 'bun:test';
import { leftOver } from '@robis/web/features/cycles/left-over.ts';
import type { Cycle } from '@robis/web/features/cycles/use-cycles.ts';

/**
 * What a board offers to move on: the last cycle that ended with issues
 * still open, to the cycle running now or the next one planned.
 */

const cycle = (id: string, startsOn: string, endsOn: string, counts: Partial<Cycle> = {}) =>
  ({
    id,
    projectId: 'p',
    name: id,
    startsOn,
    endsOn,
    total: 0,
    done: 0,
    canceled: 0,
    inProgress: 0,
    added: 0,
    carried: 0,
    ...counts,
  }) satisfies Cycle;

const TODAY = '2026-11-24';

describe('left over from the last cycle', () => {
  test('the last ended cycle with open issues, to the one running', () => {
    const older = cycle('older', '2026-10-26', '2026-11-08', { total: 4, done: 1 });
    const last = cycle('last', '2026-11-09', '2026-11-22', { total: 5, done: 2, canceled: 1 });
    const now = cycle('now', '2026-11-23', '2026-12-06');
    expect(leftOver([older, last, now], TODAY)).toEqual({ from: last, to: now, unfinished: 2 });
  });

  test('to the next one planned when none is running', () => {
    const last = cycle('last', '2026-11-09', '2026-11-22', { total: 1 });
    const next = cycle('next', '2026-11-30', '2026-12-13');
    expect(leftOver([last, next], TODAY)?.to.id).toBe('next');
  });

  test('nothing when all of it was finished, or there is nowhere to move it', () => {
    const finished = cycle('last', '2026-11-09', '2026-11-22', { total: 3, done: 2, canceled: 1 });
    const now = cycle('now', '2026-11-23', '2026-12-06');
    expect(leftOver([finished, now], TODAY)).toBeNull();
    const open = cycle('last', '2026-11-09', '2026-11-22', { total: 3 });
    expect(leftOver([open], TODAY)).toBeNull();
    expect(leftOver([], TODAY)).toBeNull();
  });

  test('a cycle ending today is still running, not left over', () => {
    const today = cycle('today', '2026-11-11', TODAY, { total: 2 });
    expect(leftOver([today], TODAY)).toBeNull();
  });
});
