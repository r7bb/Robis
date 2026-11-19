'use client';

import { useCallback, useEffect, useState } from 'react';
import { focusCommand, isFocusKey } from '../../lib/focus-mode.ts';
import { busyElsewhere } from '../../lib/key-guard.ts';
import { useCommands } from '../command/command-provider.tsx';

/**
 * Focus mode: the left rail and the chat put away, so only the board (or
 * the page) is left. The backslash key, the top bar's Focus button or the
 * palette turn it on and off; it is kept on this device, read after the
 * first paint as the server cannot know it.
 */

const STORAGE_KEY = 'robis.focus';

export function useFocusMode() {
  // Null until the saved choice is read, so nothing is saved before it.
  const [on, setOn] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setOn(localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      // Private mode: it starts off, and is not remembered.
      setOn(false);
    }
  }, []);

  // Saved after each change, never from inside one.
  useEffect(() => {
    if (on === null) return;
    try {
      localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
    } catch {
      // Not remembered; it still turns.
    }
  }, [on]);

  const toggle = useCallback(() => setOn((was) => !was), []);
  /** Out of focus mode, for something that needs the rails (the chat). */
  const leave = useCallback(() => setOn((was) => (was === null ? was : false)), []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!isFocusKey(event) || event.repeat || busyElsewhere(event)) return;
      event.preventDefault();
      toggle();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  useCommands([focusCommand(Boolean(on), toggle)]);

  return { on: Boolean(on), toggle, leave };
}
