import { describe, expect, test } from 'bun:test';
import { clampChatWidth, isChatShortcut } from '@robis/web/features/workspace/use-chat-panel.ts';
import { boardToOpen } from '@robis/web/lib/last-board.ts';

const key = (code: string, mods: Partial<KeyboardEvent> = {}) =>
  ({ code, ctrlKey: false, altKey: false, metaKey: false, ...mods }) as KeyboardEvent;

describe('the chat panel', () => {
  test('is never narrower than a message needs nor wider than half the window', () => {
    expect(clampChatWidth(120, 1440)).toBe(300);
    expect(clampChatWidth(380, 1440)).toBe(380);
    expect(clampChatWidth(2000, 1440)).toBe(720);
    // A window too narrow for both limits keeps the panel usable.
    expect(clampChatWidth(400, 500)).toBe(300);
  });

  test('opens and closes on Ctrl and the backquote key only', () => {
    expect(isChatShortcut(key('Backquote', { ctrlKey: true }))).toBe(true);
    expect(isChatShortcut(key('Backquote'))).toBe(false);
    expect(isChatShortcut(key('Backquote', { ctrlKey: true, metaKey: true }))).toBe(false);
    expect(isChatShortcut(key('Backquote', { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isChatShortcut(key('KeyK', { ctrlKey: true }))).toBe(false);
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
