import { describe, expect, test } from 'bun:test';
import { type FeedItem, reactedBy, splitAtSeen } from '@robis/web/features/feed/feed-model.ts';

/** Where the feed's "new" ends, and how reactions read (Phase 2c). */

function postAt(id: string, createdAt: string): FeedItem {
  return {
    kind: 'post',
    post: {
      id,
      authorId: 'a',
      kind: 'text',
      body: id,
      photo: null,
      createdAt,
      editedAt: null,
      commentCount: 0,
      reactions: { celebrate: [], helpful: [], support: [], thanks: [], insightful: [] },
    },
  };
}

describe('the caught-up line', () => {
  const items = [
    postAt('c', '2026-11-20T12:00:00.000Z'),
    postAt('b', '2026-11-20T11:00:00.000Z'),
    postAt('a', '2026-11-20T10:00:00.000Z'),
  ];

  test('falls after what came since you last caught up', () => {
    const { fresh, earlier } = splitAtSeen(items, '2026-11-20T10:30:00.000Z');
    expect(fresh.map((i) => (i.kind === 'post' ? i.post.id : ''))).toEqual(['c', 'b']);
    expect(earlier).toHaveLength(1);
  });

  test('with no record yet, everything loaded is new', () => {
    expect(splitAtSeen(items, null).fresh).toHaveLength(3);
  });

  test('what you posted before this visit is not new to you; this visit’s is shown', () => {
    expect(splitAtSeen(items, null, 'a').fresh).toEqual([]);
    const arrived = Date.parse('2026-11-20T11:30:00.000Z');
    const shown = splitAtSeen(items, null, 'a', arrived).fresh;
    expect(shown.map((i) => (i.kind === 'post' ? i.post.id : ''))).toEqual(['c']);
  });
});

describe('who reacted', () => {
  const names = new Map([
    ['me', 'Me'],
    ['sam', 'Sam'],
    ['kim', 'Kim'],
    ['lee', 'Lee'],
  ]);

  test('says you first, then names, then how many others', () => {
    expect(reactedBy([], 'me', names)).toBe('');
    expect(reactedBy(['sam'], 'me', names)).toBe('Sam');
    expect(reactedBy(['sam', 'me'], 'me', names)).toBe('you and Sam');
    expect(reactedBy(['sam', 'kim', 'me'], 'me', names)).toBe('you, Sam and one other');
    expect(reactedBy(['sam', 'kim', 'lee', 'me'], 'me', names)).toBe('you, Sam and 2 others');
  });
});
