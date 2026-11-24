import { describe, expect, test } from 'bun:test';
import { noReactions } from '@robis/shared';
import {
  descendants,
  leaderLine,
  nestReplies,
  type Reply,
  repliesLine,
  tileTone,
} from '@robis/web/features/spaces/spaces-model.ts';

/** The reply tree and the words around a space, as the pages show them. */

const reply = (id: string, parentId: string | null): Reply => ({
  id,
  parentId,
  authorId: '00000000-0000-4000-8000-000000000001',
  body: id,
  deleted: false,
  depth: 0,
  createdAt: '2026-11-23T09:00:00.000Z',
  reactions: noReactions(),
});

describe('the reply tree', () => {
  test('puts each reply under the one it answers, oldest first at every level', () => {
    const tree = nestReplies([
      reply('a', null),
      reply('b', null),
      reply('a1', 'a'),
      reply('a2', 'a'),
      reply('a1x', 'a1'),
    ]);
    expect(tree.map((n) => n.id)).toEqual(['a', 'b']);
    expect(tree[0]!.children.map((n) => n.id)).toEqual(['a1', 'a2']);
    expect(tree[0]!.children[0]!.children.map((n) => n.id)).toEqual(['a1x']);
    expect(descendants(tree[0]!)).toBe(3);
    expect(descendants(tree[1]!)).toBe(0);
  });

  test('keeps a reply whose parent was not loaded, at the top', () => {
    const tree = nestReplies([reply('orphan', 'gone'), reply('a', null)]);
    expect(tree.map((n) => n.id)).toEqual(['orphan', 'a']);
  });
});

describe('the words around it', () => {
  test('counts replies and leaves zeros out of the helpful line', () => {
    expect(repliesLine(0)).toBe('No replies yet');
    expect(repliesLine(1)).toBe('1 reply');
    expect(repliesLine(4)).toBe('4 replies');
    expect(leaderLine(14, 3)).toBe('14 helpful · 3 answers');
    expect(leaderLine(0, 1)).toBe('1 answer');
    expect(leaderLine(2, 0)).toBe('2 helpful');
  });

  test('gives a space the same tile colour every time', () => {
    expect(tileTone('space-1')).toBe(tileTone('space-1'));
  });
});
