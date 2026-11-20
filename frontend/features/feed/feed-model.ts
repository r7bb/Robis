import type { contracts, ResponseOf } from '@robis/shared';

/**
 * The feed as the page holds it (Phase 2c): pure, so where "new" ends and
 * how reactions read are tested without a browser.
 */

export type FeedPage = ResponseOf<(typeof contracts)['feed.list']>;
export type FeedItem = FeedPage['items'][number];
export type Post = Extract<FeedItem, { kind: 'post' }>['post'];
export type Reaction = keyof Post['reactions'];

export const feedKey = (workspaceId: string) => ['feed', workspaceId] as const;

export const REACTION_NAMES: Record<Reaction, string> = {
  celebrate: 'Celebrate',
  helpful: 'Helpful',
  support: 'Support',
};

/** When an item happened, whichever kind it is. */
export function itemTime(item: FeedItem): string {
  return item.kind === 'post' ? item.post.createdAt : item.picture.createdAt;
}

export function itemKey(item: FeedItem): string {
  return item.kind === 'post' ? `post:${item.post.id}` : `picture:${item.picture.messageId}`;
}

/** Who an item is by, whichever kind it is. */
export function itemAuthor(item: FeedItem): string {
  return item.kind === 'post' ? item.post.authorId : item.picture.authorId;
}

/**
 * The items since you last caught up, and the rest. What you posted before
 * this visit is never new to you; anything from this visit, yours included,
 * is shown. With no record yet, everything else loaded counts as new: the
 * first visit shows the feed, then says you are caught up.
 */
export function splitAtSeen(
  items: readonly FeedItem[],
  seenAt: string | null,
  me: string | null = null,
  arrivedAt: number = Number.POSITIVE_INFINITY,
): { fresh: FeedItem[]; earlier: FeedItem[] } {
  const seen = seenAt ? Date.parse(seenAt) : Number.NEGATIVE_INFINITY;
  const isFresh = (item: FeedItem) => {
    const at = Date.parse(itemTime(item));
    return at > arrivedAt || (itemAuthor(item) !== me && at > seen);
  };
  return { fresh: items.filter(isFresh), earlier: items.filter((item) => !isFresh(item)) };
}

/**
 * Faces for a reaction, and what to say about them: you first if you
 * reacted, then up to two more by name; never a bare count of everyone.
 */
export function reactedBy(
  ids: readonly string[],
  me: string | null,
  names: ReadonlyMap<string, string>,
): string {
  if (ids.length === 0) return '';
  const ordered = me && ids.includes(me) ? [me, ...ids.filter((id) => id !== me)] : [...ids];
  const named = ordered.slice(0, 2).map((id) => (id === me ? 'you' : (names.get(id) ?? 'someone')));
  const others = ordered.length - named.length;
  if (others === 0) return named.join(' and ');
  return `${named.join(', ')} and ${others === 1 ? 'one other' : `${others} others`}`;
}
