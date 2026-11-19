import { describe, expect, test } from 'bun:test';
import { clampDockHeight, isDockShortcut } from '@robis/web/features/workspace/use-dock.ts';
import { boardToOpen } from '@robis/web/lib/last-board.ts';

const key = (code: string, mods: Partial<KeyboardEvent> = {}) =>
  ({ code, ctrlKey: false, altKey: false, metaKey: false, ...mods }) as KeyboardEvent;

describe('the chat dock', () => {
  test('is never shorter than a few lines nor taller than most of the window', () => {
    expect(clampDockHeight(40, 900)).toBe(160);
    expect(clampDockHeight(300, 900)).toBe(300);
    expect(clampDockHeight(2000, 900)).toBe(630);
    // A window too short for both limits keeps the dock usable.
    expect(clampDockHeight(400, 200)).toBe(160);
  });

  test('opens and closes on Ctrl and the backquote key only', () => {
    expect(isDockShortcut(key('Backquote', { ctrlKey: true }))).toBe(true);
    expect(isDockShortcut(key('Backquote'))).toBe(false);
    expect(isDockShortcut(key('Backquote', { ctrlKey: true, metaKey: true }))).toBe(false);
    expect(isDockShortcut(key('Backquote', { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isDockShortcut(key('KeyK', { ctrlKey: true }))).toBe(false);
  });
});

describe('the board a workspace opens on', () => {
  const projects = [
    { id: 'a', archived: false },
    { id: 'b', archived: false },
    { id: 'c', archived: true },
  ];

  test('is the one last open while it is still there', () => {
    expect(boardToOpen(projects, 'b')).toBe('b');
  });

  test('else the first project not archived', () => {
    expect(boardToOpen(projects, null)).toBe('a');
    expect(boardToOpen(projects, 'gone')).toBe('a');
    expect(boardToOpen(projects, 'c')).toBe('a');
  });

  test('and none when there are no projects', () => {
    expect(boardToOpen([], 'a')).toBeNull();
    expect(boardToOpen([{ id: 'c', archived: true }], null)).toBeNull();
  });
});
