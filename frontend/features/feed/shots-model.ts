import type { Story } from '../stories/story-model.ts';

/**
 * The Different shots stack on the feed (Phase 2c): pure, so what shows,
 * in what order, and what a swipe means are tested without a browser.
 */

/** At most this many ideas at once: a few to try, not a pile to work through. */
export const SHOTS_SHOWN = 5;

/** How far a card must travel, in pixels, before letting go counts as a swipe. */
export const SWIPE_DISTANCE = 96;

/** Movement under this is a tap, not the start of a swipe. */
const TAP_SLOP = 6;

/** A story is a shot when it has somewhere to try. */
const isShot = (story: Story) => story.tryPath !== null && story.tryLabel !== null;

/**
 * The shots to show: live ones not set aside, newest first, a few at most.
 * The list is the server's live list, so an expired shot is already gone.
 */
export function visibleShots(
  stories: readonly Story[],
  setAside: ReadonlySet<string>,
  max = SHOTS_SHOWN,
): Story[] {
  return stories
    .filter((story) => isShot(story) && !setAside.has(story.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, max);
}

export type SwipeVerdict = 'try' | 'not-now' | 'tap' | 'stay';

/** What letting go of a card means, from how far it moved. */
export function verdictOf(dx: number, dy: number): SwipeVerdict {
  if (Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP) return 'tap';
  if (dx >= SWIPE_DISTANCE) return 'try';
  if (dx <= -SWIPE_DISTANCE) return 'not-now';
  return 'stay';
}

/** The shots this person set aside, kept in their browser only. */
const SET_ASIDE_KEY = 'robis.shots.aside';

export function readSetAside(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${SET_ASIDE_KEY}.${userId}`);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Saved pruned to the stories still live, so it never grows past a few days. */
export function writeSetAside(userId: string, ids: ReadonlySet<string>, live: readonly Story[]) {
  const kept = live.map((story) => story.id).filter((id) => ids.has(id));
  try {
    localStorage.setItem(`${SET_ASIDE_KEY}.${userId}`, JSON.stringify(kept));
  } catch {
    // Private mode or full storage: set-aside shots simply come back next visit.
  }
}
