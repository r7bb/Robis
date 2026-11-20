import { describe, expect, test } from 'bun:test';
import {
  ageOf,
  byAuthor,
  hasUnseen,
  placeAfter,
  placeBefore,
  type Story,
  startAt,
  stripOrder,
} from '@robis/web/features/stories/story-model.ts';

/**
 * What the stories bar and viewer do (B2), without a browser: who comes
 * first, where a person's stories start, and where next and back go.
 */

function story(id: string, authorId: string, minutesAgo: number): Story {
  const created = new Date(Date.UTC(2026, 10, 20, 12, 0) - minutesAgo * 60_000);
  return {
    id,
    authorId,
    kind: 'text',
    body: id,
    tone: 'sea',
    url: null,
    width: null,
    height: null,
    tryPath: null,
    tryLabel: null,
    createdAt: created.toISOString(),
    expiresAt: new Date(created.getTime() + 86_400_000).toISOString(),
  };
}

// Oldest first, as the API lists them.
const list = [
  story('a1', 'amy', 300),
  story('b1', 'ben', 200),
  story('a2', 'amy', 100),
  story('m1', 'me', 50),
  story('c1', 'cat', 10),
];
const grouped = byAuthor(list);

describe('the strip', () => {
  test('groups each person’s stories, oldest first', () => {
    expect(grouped.get('amy')!.map((s) => s.id)).toEqual(['a1', 'a2']);
  });

  test('puts you first, then the unseen newest first, then the seen', () => {
    const seen = new Set(['c1']);
    expect(stripOrder(grouped, seen, 'me')).toEqual(['me', 'amy', 'ben', 'cat']);
    expect(stripOrder(grouped, new Set(), 'someone-else')).toEqual(['cat', 'me', 'amy', 'ben']);
  });

  test('a person is unseen until every one of theirs is seen', () => {
    expect(hasUnseen(grouped.get('amy')!, new Set(['a1']))).toBe(true);
    expect(hasUnseen(grouped.get('amy')!, new Set(['a1', 'a2']))).toBe(false);
  });
});

describe('the viewer', () => {
  const order = ['amy', 'ben', 'cat'];

  test('starts at the first story not yet seen, or the first', () => {
    expect(startAt(grouped.get('amy')!, new Set(['a1']))).toBe(1);
    expect(startAt(grouped.get('amy')!, new Set(['a1', 'a2']))).toBe(0);
  });

  test('next goes through theirs, then on to the next person, then ends', () => {
    const seen = new Set<string>();
    expect(placeAfter({ author: 0, story: 0 }, order, grouped, seen)).toEqual({
      author: 0,
      story: 1,
    });
    expect(placeAfter({ author: 0, story: 1 }, order, grouped, seen)).toEqual({
      author: 1,
      story: 0,
    });
    expect(placeAfter({ author: 2, story: 0 }, order, grouped, seen)).toBeNull();
  });

  test('back goes to the previous person’s last, and stays at the very start', () => {
    expect(placeBefore({ author: 1, story: 0 }, order, grouped)).toEqual({ author: 0, story: 1 });
    expect(placeBefore({ author: 0, story: 0 }, order, grouped)).toEqual({ author: 0, story: 0 });
  });

  test('says how old a story is, never more than hours', () => {
    const now = Date.UTC(2026, 10, 20, 12, 0);
    expect(ageOf(new Date(now - 20_000).toISOString(), now)).toBe('Just now');
    expect(ageOf(new Date(now - 12 * 60_000).toISOString(), now)).toBe('12 min ago');
    expect(ageOf(new Date(now - 5 * 3_600_000).toISOString(), now)).toBe('5 h ago');
  });
});
