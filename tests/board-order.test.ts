import { describe, expect, test } from 'bun:test';
import { dropPosition } from '@robis/web/lib/board-order.ts';

/** Where a dropped card lands (C1): between the cards it was dropped between. */

const card = (id: string, position: string | null) => ({ id, status: 'TODO' as const, position });
const column = [card('a', 'a0'), card('b', 'a1'), card('c', 'a2')];

describe('dropping a card', () => {
  test('between two cards gives a key between theirs', () => {
    const key = dropPosition(column, 'c', 1);
    expect(key > 'a0' && key < 'a1').toBe(true);
  });

  test('at the top and the bottom', () => {
    expect(dropPosition(column, 'b', 0) < 'a0').toBe(true);
    expect(dropPosition(column, 'a', 2) > 'a2').toBe(true);
  });

  test('next to a card made offline uses the nearest card with a key', () => {
    const withOffline = [card('new', null), card('a', 'a0'), card('b', 'a1')];
    const key = dropPosition(withOffline, 'b', 1);
    expect(key < 'a0').toBe(true);
  });

  test('a slot past the end is the end', () => {
    expect(dropPosition(column, 'a', 99) > 'a2').toBe(true);
  });
});
