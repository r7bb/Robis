import { describe, expect, test } from 'bun:test';
import {
  SHOTS_SHOWN,
  SWIPE_DISTANCE,
  verdictOf,
  visibleShots,
} from '@robis/web/features/feed/shots-model.ts';
import type { Story } from '@robis/web/features/stories/story-model.ts';

/** What the Different shots stack shows, and what a swipe means (Phase 2c). */

function story(
  id: string,
  minutesAgo: number,
  tryPath: string | null = '/workspaces/w/feed',
): Story {
  const created = new Date(Date.UTC(2026, 10, 20, 12) - minutesAgo * 60_000);
  return {
    id,
    authorId: 'bot',
    kind: 'text',
    body: `Idea ${id}`,
    tone: 'dusk',
    url: null,
    width: null,
    height: null,
    tryPath,
    tryLabel: tryPath ? 'Try it' : null,
    createdAt: created.toISOString(),
    expiresAt: new Date(created.getTime() + 86_400_000).toISOString(),
  };
}

describe('the stack', () => {
  test('shows shots only, newest first, without those set aside, a few at most', () => {
    const live = [story('a', 30), story('b', 10), story('plain', 5, null), story('c', 20)];
    expect(visibleShots(live, new Set()).map((s) => s.id)).toEqual(['b', 'c', 'a']);
    expect(visibleShots(live, new Set(['b'])).map((s) => s.id)).toEqual(['c', 'a']);
    const many = Array.from({ length: 9 }, (_, i) => story(`s${i}`, i));
    expect(visibleShots(many, new Set())).toHaveLength(SHOTS_SHOWN);
  });
});

describe('a swipe', () => {
  test('far enough right is Try it, left is Not now, barely moved is a tap, between is nothing', () => {
    expect(verdictOf(SWIPE_DISTANCE, 0)).toBe('try');
    expect(verdictOf(-SWIPE_DISTANCE - 1, 10)).toBe('not-now');
    expect(verdictOf(2, -3)).toBe('tap');
    expect(verdictOf(40, 0)).toBe('stay');
    expect(verdictOf(0, 60)).toBe('stay');
  });
});
