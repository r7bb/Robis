import type { Command } from './commands.ts';

/** Focus mode's key and palette entry, apart from the hook so they test without React. */

/** The key that turns focus mode on and off, with nothing held. */
const FOCUS_KEY = '\\';

export function isFocusKey(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>) {
  if (event.key !== FOCUS_KEY || event.metaKey) return false;
  // On German or Nordic keyboards the backslash is AltGr, which arrives as
  // Ctrl and Alt together; either alone is someone else's shortcut.
  const altGr = event.ctrlKey && event.altKey;
  return altGr || (!event.ctrlKey && !event.altKey);
}

/** The palette's entry for it, worded for the way it will go. */
export function focusCommand(on: boolean, toggle: () => void): Command {
  return {
    id: 'focus-mode',
    title: on ? 'Leave focus mode' : 'Focus mode',
    group: 'Actions',
    keywords: ['focus', 'hide', 'sidebar', 'chat', 'zen'],
    hint: FOCUS_KEY,
    run: toggle,
  };
}
