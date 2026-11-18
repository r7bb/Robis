import { describe, expect, test } from 'bun:test';
import { ROLES } from '@robis/shared';
import { BOARD_SHORTCUTS, boardKeyFor, shortcutsFor, stepCard } from '@robis/web/lib/board-keys.ts';
import { may } from '@robis/web/lib/permissions.ts';

/** The board's single keys (C2): which key does what, and where focus goes. */

const press = (
  key: string,
  extra: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {},
) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...extra,
});

describe('which key does what', () => {
  test('the letters, whatever the case', () => {
    expect(boardKeyFor(press('c'))).toEqual({ id: 'compose' });
    expect(boardKeyFor(press('C'))).toEqual({ id: 'compose' });
    expect(boardKeyFor(press('j'))).toEqual({ id: 'next' });
    expect(boardKeyFor(press('k'))).toEqual({ id: 'previous' });
    expect(boardKeyFor(press('h'))).toEqual({ id: 'left' });
    expect(boardKeyFor(press('l'))).toEqual({ id: 'right' });
    expect(boardKeyFor(press('m'))).toEqual({ id: 'lift' });
    expect(boardKeyFor(press('x'))).toEqual({ id: 'select' });
    expect(boardKeyFor(press('f'))).toEqual({ id: 'filter' });
    expect(boardKeyFor(press('v'))).toEqual({ id: 'views' });
  });

  test('a number moves the card to that column', () => {
    expect(boardKeyFor(press('1'))).toEqual({ id: 'status', status: 'TODO' });
    expect(boardKeyFor(press('4'))).toEqual({ id: 'status', status: 'DONE' });
    expect(boardKeyFor(press('5'))).toBeNull();
  });

  test('Delete or Backspace, slash, question mark and Escape', () => {
    expect(boardKeyFor(press('Delete'))).toEqual({ id: 'delete' });
    expect(boardKeyFor(press('Backspace'))).toEqual({ id: 'delete' });
    expect(boardKeyFor(press('/'))).toEqual({ id: 'palette' });
    expect(boardKeyFor(press('?', { shiftKey: true }))).toEqual({ id: 'help' });
    expect(boardKeyFor(press('Escape'))).toEqual({ id: 'escape' });
  });

  test('never with Ctrl, Cmd or Alt held: those belong to the browser', () => {
    for (const held of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      expect(boardKeyFor(press('c', { [held]: true }))).toBeNull();
    }
  });

  test('keys it does not know do nothing', () => {
    expect(boardKeyFor(press('q'))).toBeNull();
    expect(boardKeyFor(press('ArrowDown'))).toBeNull();
    expect(boardKeyFor(press('Enter'))).toBeNull();
  });
});

describe('moving between cards', () => {
  const columns = [['a1', 'a2', 'a3'], [], ['c1'], ['d1', 'd2']];

  test('from nowhere, the first card', () => {
    expect(stepCard(columns, null, 'next')).toBe('a1');
    expect(stepCard([[], ['b1']], null, 'right')).toBe('b1');
    expect(stepCard([[], []], null, 'next')).toBeNull();
  });

  test('down and up a column, stopping at its ends', () => {
    expect(stepCard(columns, 'a1', 'next')).toBe('a2');
    expect(stepCard(columns, 'a3', 'next')).toBe('a3');
    expect(stepCard(columns, 'a2', 'previous')).toBe('a1');
    expect(stepCard(columns, 'a1', 'previous')).toBe('a1');
  });

  test('across, skipping empty columns, at the same height or the last card', () => {
    expect(stepCard(columns, 'a3', 'right')).toBe('c1');
    expect(stepCard(columns, 'c1', 'right')).toBe('d1');
    expect(stepCard(columns, 'd2', 'left')).toBe('c1');
    expect(stepCard(columns, 'a2', 'left')).toBe('a2');
    expect(stepCard(columns, 'd2', 'right')).toBe('d2');
  });

  test('a card that has gone starts again at the first', () => {
    expect(stepCard(columns, 'gone', 'next')).toBe('a1');
  });
});

describe('the help lists what you may do', () => {
  test('every shortcut that needs an action is listed exactly when its button shows', () => {
    for (const role of ROLES) {
      const listed = new Set(shortcutsFor(role).map((s) => s.id));
      for (const shortcut of BOARD_SHORTCUTS) {
        const expected = !shortcut.action || may(role, shortcut.action);
        expect(listed.has(shortcut.id), `${role} ${shortcut.id}`).toBe(expected);
      }
    }
  });

  test('a guest can still move around, open cards, filter and ask for help', () => {
    expect(shortcutsFor('GUEST').map((s) => s.id)).toEqual([
      'next',
      'previous',
      'left',
      'right',
      'open',
      'filter',
      'views',
      'palette',
      'help',
    ]);
  });
});
