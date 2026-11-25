'use client';

import { useParams } from 'next/navigation';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { SaphaPanel } from './sapha-panel.tsx';
import { isSaphaShortcut } from './turn-model.ts';

type Opened = { firstWords: string | null; at: number };

const SaphaContext = createContext<((words?: string) => void) | null>(null);

/**
 * Sapha's panel, for every page of a workspace: Ctrl J or Cmd J opens and
 * closes it, and the palette's Ask Sapha opens it with the words typed.
 */
export function SaphaPanelProvider({ children }: { children: ReactNode }) {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [opened, setOpened] = useState<Opened | null>(null);
  const open = useCallback(
    (words?: string) => setOpened({ firstWords: words?.trim() || null, at: Date.now() }),
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isSaphaShortcut(event) || event.repeat) return;
      event.preventDefault();
      setOpened((was) => (was ? null : { firstWords: null, at: Date.now() }));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <SaphaContext.Provider value={open}>
      {children}
      {opened && workspaceId ? (
        <SaphaPanel
          // Opened again with new words, it starts afresh with them.
          key={opened.at}
          workspaceId={workspaceId}
          firstWords={opened.firstWords}
          onClose={() => setOpened(null)}
        />
      ) : null}
    </SaphaContext.Provider>
  );
}

/** Open Sapha's panel, asking these words at once when given. */
export function useOpenSapha(): ((words?: string) => void) | null {
  return useContext(SaphaContext);
}
