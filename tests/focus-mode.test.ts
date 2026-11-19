import { describe, expect, test } from 'bun:test';
import { rankCommands } from '@robis/web/lib/commands.ts';
import { focusCommand, isFocusKey } from '@robis/web/lib/focus-mode.ts';

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe('focus mode', () => {
  test('backslash with nothing held turns it, and nothing else does', () => {
    expect(isFocusKey(key('\\'))).toBe(true);
    expect(isFocusKey(key('\\', { ctrlKey: true }))).toBe(false);
    expect(isFocusKey(key('\\', { metaKey: true }))).toBe(false);
    expect(isFocusKey(key('\\', { altKey: true }))).toBe(false);
    // AltGr, as German and Nordic keyboards type a backslash.
    expect(isFocusKey(key('\\', { ctrlKey: true, altKey: true }))).toBe(true);
    expect(isFocusKey(key('/'))).toBe(false);
    expect(isFocusKey(key('f'))).toBe(false);
  });

  test('the palette names it for the way it will go, with its key', () => {
    let turned = 0;
    const off = focusCommand(false, () => turned++);
    const on = focusCommand(true, () => turned++);

    expect(off.title).toBe('Focus mode');
    expect(on.title).toBe('Leave focus mode');
    expect(off.hint).toBe('\\');
    off.run?.();
    expect(turned).toBe(1);
  });

  test('the palette finds it by what people would type', () => {
    const command = focusCommand(false, () => {});
    for (const query of ['focus', 'hide sidebar', 'zen']) {
      expect(rankCommands([command], query).map((c) => c.id)).toContain('focus-mode');
    }
  });
});
