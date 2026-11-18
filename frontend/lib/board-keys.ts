import { BOARD_COLUMNS, type IssueStatus, type Role } from '@robis/shared';
import { type Action, may } from './permissions.ts';

/**
 * The board's single-key shortcuts (C2): the table the help overlay shows,
 * which key means what, and where focus goes between cards. No React here.
 */

export type BoardKeyId =
  | 'compose'
  | 'next'
  | 'previous'
  | 'left'
  | 'right'
  | 'open'
  | 'status'
  | 'lift'
  | 'select'
  | 'delete'
  | 'filter'
  | 'views'
  | 'palette'
  | 'help'
  | 'escape';

export type BoardShortcut = {
  id: BoardKeyId;
  /** The keys as the help overlay draws them. */
  keys: readonly string[];
  does: string;
  section: 'Cards' | 'Board';
  /** Needs this action, the same check as the button that does it. */
  action?: Action;
};

export const BOARD_SHORTCUTS: readonly BoardShortcut[] = [
  { id: 'compose', keys: ['C'], does: 'New issue', section: 'Board', action: 'newIssue' },
  { id: 'next', keys: ['J'], does: 'Next card down', section: 'Cards' },
  { id: 'previous', keys: ['K'], does: 'Card above', section: 'Cards' },
  { id: 'left', keys: ['H'], does: 'Card in the column to the left', section: 'Cards' },
  { id: 'right', keys: ['L'], does: 'Card in the column to the right', section: 'Cards' },
  { id: 'open', keys: ['Enter'], does: 'Open the card', section: 'Cards' },
  {
    id: 'status',
    keys: ['1', '2', '3', '4'],
    does: 'Move it to Todo, In Progress, In Review or Done',
    section: 'Cards',
    action: 'editIssue',
  },
  {
    id: 'lift',
    keys: ['M'],
    does: 'Pick it up; arrows move it, Space puts it down',
    section: 'Cards',
    action: 'editIssue',
  },
  {
    id: 'select',
    keys: ['X'],
    does: 'Select it for a change to several',
    section: 'Cards',
    action: 'editIssue',
  },
  {
    id: 'delete',
    keys: ['Delete', '⌫'],
    does: 'Delete it, after you confirm',
    section: 'Cards',
    action: 'deleteIssue',
  },
  { id: 'filter', keys: ['F'], does: 'Filter the board', section: 'Board' },
  {
    id: 'views',
    keys: ['V'],
    does: 'Saved views, or the filters while there are none',
    section: 'Board',
  },
  { id: 'palette', keys: ['/'], does: 'Search or run a command', section: 'Board' },
  { id: 'help', keys: ['?'], does: 'These shortcuts', section: 'Board' },
  { id: 'escape', keys: ['Esc'], does: 'Stop selecting', section: 'Board', action: 'editIssue' },
];

const LETTERS: Record<string, BoardKeyId> = {
  c: 'compose',
  j: 'next',
  k: 'previous',
  h: 'left',
  l: 'right',
  m: 'lift',
  x: 'select',
  f: 'filter',
  v: 'views',
};

const KEYS: Record<string, BoardKeyId> = {
  Delete: 'delete',
  Backspace: 'delete',
  '/': 'palette',
  '?': 'help',
  Escape: 'escape',
};

type KeyLike = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean };

/**
 * The shortcut a key press means, or null. Never with Ctrl, Cmd or Alt held,
 * which belong to the browser and the palette. Enter opens a card from the
 * card itself, so it is not a board-wide key.
 */
export function boardKeyFor(event: KeyLike): { id: BoardKeyId; status?: IssueStatus } | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const column = /^[1-9]$/.test(event.key) ? BOARD_COLUMNS[Number(event.key) - 1] : undefined;
  if (column) return { id: 'status', status: column };
  const id = LETTERS[event.key.toLowerCase()] ?? KEYS[event.key];
  return id ? { id } : null;
}

/** The shortcuts this role may use, in the help's order. */
export function shortcutsFor(role: Role | undefined): BoardShortcut[] {
  return BOARD_SHORTCUTS.filter((s) => !s.action || may(role, s.action));
}

/**
 * The card to focus after a step from `current`: down or up its column,
 * stopping at the ends, or across to the next column with cards in it, at
 * the same height or its last card. From no card (or one that has gone),
 * the first card on the board.
 */
export function stepCard(
  columns: readonly (readonly string[])[],
  current: string | null,
  step: 'next' | 'previous' | 'left' | 'right',
): string | null {
  const col = current ? columns.findIndex((c) => c.includes(current)) : -1;
  if (col < 0) return columns.find((c) => c.length > 0)?.[0] ?? null;
  const cards = columns[col]!;
  const row = cards.indexOf(current!);
  if (step === 'next') return cards[Math.min(row + 1, cards.length - 1)]!;
  if (step === 'previous') return cards[Math.max(row - 1, 0)]!;
  const direction = step === 'left' ? -1 : 1;
  for (let at = col + direction; at >= 0 && at < columns.length; at += direction) {
    const there = columns[at]!;
    if (there.length > 0) return there[Math.min(row, there.length - 1)]!;
  }
  return current;
}
