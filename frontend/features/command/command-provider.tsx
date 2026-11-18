'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { call } from '../../lib/api.ts';
import { type Command, isPaletteShortcut } from '../../lib/commands.ts';
import { CommandPalette } from './command-palette.tsx';

/**
 * The command palette's home (C2): one per workspace, opened with Ctrl K or
 * Cmd K from any of its pages. A page adds what only it can do (the board's
 * New issue, the open issue's status) with `useCommands`; everything else
 * the palette finds for itself.
 */

type Registry = {
  /** Offer a page's commands, under the id of the component adding them. */
  set: (id: string, commands: readonly Command[]) => void;
  remove: (id: string) => void;
  open: () => void;
};

const CommandContext = createContext<Registry | null>(null);

export function CommandProvider({ children }: { children: ReactNode }) {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [open, setOpen] = useState(false);
  // A ref, not state: a page adding its commands must not re-render the tree.
  const pages = useRef(new Map<string, readonly Command[]>()).current;
  const openPalette = useCallback(() => setOpen(true), []);
  // While it is open, a page that changes its commands (its data arrived, a
  // status moved) shows the palette the new ones. Closed, nothing re-renders.
  const isOpen = useRef(false);
  isOpen.current = open;
  const [, refresh] = useReducer((n: number) => n + 1, 0);

  // The same query, and so the same cache entry, as the pages' own.
  const workspace = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => call(contracts['workspaces.get'], { params: { workspaceId } }),
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event) || event.repeat) return;
      // Ahead of the browser's own Ctrl K, which jumps to its search bar.
      event.preventDefault();
      setOpen((was) => !was);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const registry = useMemo<Registry>(
    () => ({
      set: (id, commands) => {
        pages.set(id, commands);
        if (isOpen.current) refresh();
      },
      remove: (id) => {
        pages.delete(id);
        if (isOpen.current) refresh();
      },
      open: openPalette,
    }),
    [pages, openPalette],
  );

  return (
    <CommandContext.Provider value={registry}>
      {children}
      {open && (
        <CommandPalette
          workspaceId={workspaceId}
          role={workspace.data?.workspace.role}
          pageCommands={[...pages.values()].flat()}
          onClose={() => setOpen(false)}
        />
      )}
    </CommandContext.Provider>
  );
}

/**
 * Offer these commands in the palette while this component is on screen.
 * Set after every render, so they close over the latest state.
 */
export function useCommands(commands: readonly Command[]) {
  const registry = useContext(CommandContext);
  const id = useId();
  // Every render: cheap, and the palette always sees today's closures.
  useEffect(() => {
    registry?.set(id, commands);
  });
  useEffect(() => {
    return () => registry?.remove(id);
  }, [registry, id]);
}

/** Open the palette from a button, for anyone not using the shortcut. */
export function useOpenPalette(): (() => void) | null {
  return useContext(CommandContext)?.open ?? null;
}
