import type { contracts, ResponseOf, STORY_TONES } from '@robis/shared';

/**
 * Stories as the app holds them (B2): pure, so the order a viewer plays them
 * in and what counts as seen are tested without a browser.
 */

export type Story = ResponseOf<(typeof contracts)['stories.list']>['stories'][number];
export type StoryTone = (typeof STORY_TONES)[number];

/** The cache key of a workspace's stories, as the realtime events name it. */
export const storiesKey = (workspaceId: string) => ['stories', workspaceId] as const;

/** How long one story shows before the next, when it plays on its own. */
export const STORY_SHOW_MS = 6000;

/**
 * A text story's background, by tone. Gradients on fixed dark bases, so
 * white text reads on every one of them in every theme.
 */
export const TONE_BACKGROUNDS: Record<StoryTone, string> = {
  dusk: 'linear-gradient(150deg, #312e81 0%, #7c3aed 55%, #db2777 100%)',
  sea: 'linear-gradient(150deg, #0c4a6e 0%, #0369a1 50%, #0d9488 100%)',
  forest: 'linear-gradient(150deg, #052e16 0%, #166534 55%, #65a30d 100%)',
  ember: 'linear-gradient(150deg, #431407 0%, #c2410c 55%, #f59e0b 100%)',
  ink: 'linear-gradient(150deg, #0a0a0a 0%, #27272a 60%, #3f3f46 100%)',
};

export const TONE_NAMES: Record<StoryTone, string> = {
  dusk: 'Dusk',
  sea: 'Sea',
  forest: 'Forest',
  ember: 'Ember',
  ink: 'Ink',
};

/** Each author's stories, oldest first, in the order the list gave them. */
export function byAuthor(stories: readonly Story[]): Map<string, Story[]> {
  const grouped = new Map<string, Story[]>();
  for (const story of stories) {
    grouped.set(story.authorId, [...(grouped.get(story.authorId) ?? []), story]);
  }
  return grouped;
}

/**
 * The order of the strip: you first, then anyone with something you have
 * not seen, newest first, then everyone already seen, newest first.
 */
export function stripOrder(
  grouped: ReadonlyMap<string, readonly Story[]>,
  seen: ReadonlySet<string>,
  me: string | null,
): string[] {
  const newest = (authorId: string) => {
    const list = grouped.get(authorId) ?? [];
    return list[list.length - 1]?.createdAt ?? '';
  };
  const others = [...grouped.keys()].filter((id) => id !== me);
  const unseen = (id: string) => hasUnseen(grouped.get(id) ?? [], seen);
  others.sort(
    (a, b) => Number(unseen(b)) - Number(unseen(a)) || newest(b).localeCompare(newest(a)),
  );
  return me && grouped.has(me) ? [me, ...others] : others;
}

export function hasUnseen(stories: readonly Story[], seen: ReadonlySet<string>): boolean {
  return stories.some((story) => !seen.has(story.id));
}

/** Where an author's stories start: the first not yet seen, or the first. */
export function startAt(stories: readonly Story[], seen: ReadonlySet<string>): number {
  const index = stories.findIndex((story) => !seen.has(story.id));
  return index === -1 ? 0 : index;
}

/** "Just now", "12 min ago", "3 h ago": a story is never more than a day old. */
export function ageOf(createdAt: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
}

/**
 * The ids this person has seen, kept in this browser only: what you looked
 * at is nobody else's business, so the server is never told. Pruned to the
 * stories still showing, so it never grows past a day's worth.
 */
const SEEN_KEY = 'robis.stories.seen';

export function readSeen(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${SEEN_KEY}.${userId}`);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function writeSeen(userId: string, seen: ReadonlySet<string>, live: readonly Story[]) {
  const kept = live.map((story) => story.id).filter((id) => seen.has(id));
  try {
    localStorage.setItem(`${SEEN_KEY}.${userId}`, JSON.stringify(kept));
  } catch {
    // Private mode or full storage: rings simply show as unseen next time.
  }
}

/** Where the viewer is: which author in its order, and which of theirs. */
export type Place = { author: number; story: number };

/** The story after this one: theirs, then the next person's; null at the end. */
export function placeAfter(
  at: Place,
  order: readonly string[],
  grouped: ReadonlyMap<string, readonly Story[]>,
  seen: ReadonlySet<string>,
): Place | null {
  const count = grouped.get(order[at.author] ?? '')?.length ?? 0;
  if (at.story + 1 < count) return { ...at, story: at.story + 1 };
  for (let author = at.author + 1; author < order.length; author++) {
    const list = grouped.get(order[author]!) ?? [];
    if (list.length > 0) return { author, story: startAt(list, seen) };
  }
  return null;
}

/** The story before this one: theirs, then the previous person's last; stays at the very start. */
export function placeBefore(
  at: Place,
  order: readonly string[],
  grouped: ReadonlyMap<string, readonly Story[]>,
): Place {
  if (at.story > 0) return { ...at, story: at.story - 1 };
  for (let author = at.author - 1; author >= 0; author--) {
    const list = grouped.get(order[author]!) ?? [];
    if (list.length > 0) return { author, story: list.length - 1 };
  }
  return { ...at, story: 0 };
}
