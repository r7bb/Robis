'use client';

import { useParams } from 'next/navigation';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { useAssist } from '../../assist/use-assist.ts';
import { SaphaPanel } from './sapha-panel.tsx';
import { isSaphaShortcut } from './turn-model.ts';

type Opened = { firstWords: string | null; about: string | null; at: number };

/** How the panel opens: asking some words at once, or about one issue, by key. */
type Opening = { ask?: string; about?: string };

const SaphaContext = createContext<((opening?: Opening) => void) | null>(null);

/**
 * Sapha's panel, for every page of a workspace: Ctrl J or Cmd J opens and
 * closes it, the palette's Ask Sapha opens it with the words typed, and an
 * issue's Ask Sapha opens it about that issue.
 */
export function SaphaPanelProvider({ children }: { children: ReactNode }) {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [opened, setOpened] = useState<Opened | null>(null);
  const open = useCallback(
    ({ ask, about }: Opening = {}) =>
      setOpened({ firstWords: ask?.trim() || null, about: about ?? null, at: Date.now() }),
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isSaphaShortcut(event) || event.repeat) return;
      event.preventDefault();
      setOpened((was) => (was ? null : { firstWords: null, about: null, at: Date.now() }));
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
          about={opened.about}
          onClose={() => setOpened(null)}
        />
      ) : null}
    </SaphaContext.Provider>
  );
}

/** Open Sapha's panel, asking some words at once, or about an issue. */
export function useOpenSapha(): ((opening?: Opening) => void) | null {
  return useContext(SaphaContext);
}

/** Ask Sapha about an issue, by key: null where it cannot answer, as assistance is off. */
export function useAskSaphaAbout(workspaceId: string): ((issueKey: string) => void) | null {
  const open = useOpenSapha();
  const { available } = useAssist(workspaceId);
  return open && available ? (issueKey) => open({ about: issueKey }) : null;
}
