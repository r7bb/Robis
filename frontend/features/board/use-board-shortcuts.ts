'use client';

import type { IssueStatus, Role } from '@robis/shared';
import { useEffect, useRef } from 'react';
import { BOARD_SHORTCUTS, type BoardKeyId, boardKeyFor } from '../../lib/board-keys.ts';
import { busyElsewhere } from '../../lib/key-guard.ts';
import { may } from '../../lib/permissions.ts';

type Handlers = Partial<Record<BoardKeyId, (status?: IssueStatus) => void>>;

/** A key held down repeats; these should happen once per press. */
const ONCE: ReadonlySet<BoardKeyId> = new Set([
  'compose',
  'status',
  'lift',
  'select',
  'delete',
  'help',
]);

/**
 * The board's single keys (C2). A key does nothing while you type, while a
 * dialog is open, with Ctrl, Cmd or Alt held, or when something on the page
 * already handled it (a lifted card's arrows); a held key does not repeat
 * a change; and nothing a role may not do, the same check as the button
 * for it.
 */
export function useBoardShortcuts(role: Role | undefined, handlers: Handlers) {
  // The latest handlers without listening afresh on every render.
  const latest = useRef(handlers);
  latest.current = handlers;
  const roleRef = useRef(role);
  roleRef.current = role;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (busyElsewhere(event)) return;
      const pressed = boardKeyFor(event);
      if (!pressed || (event.repeat && ONCE.has(pressed.id))) return;
      const shortcut = BOARD_SHORTCUTS.find((s) => s.id === pressed.id);
      if (shortcut?.action && !may(roleRef.current, shortcut.action)) return;
      const run = latest.current[pressed.id];
      if (!run) return;
      event.preventDefault();
      run(pressed.status);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
