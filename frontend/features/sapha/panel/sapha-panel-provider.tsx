'use client';

import { useParams } from 'next/navigation';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
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
  // What had focus when the panel opened, given it back when the panel closes.
  const opener = useRef<HTMLElement | null>(null);
  const open = useCallback(({ ask, about }: Opening = {}) => {
    opener.current = focused();
    setOpened({ firstWords: ask?.trim() || null, about: about ?? null, at: Date.now() });
  }, []);
  const close = useCallback(() => {
    setOpened(null);
    // After the dialog has gone, as the page is inert while it is open.
    setTimeout(() => {
      if (opener.current?.isConnected) opener.current.focus();
      opener.current = null;
    }, 0);
  }, []);

  // Read by the shortcut, which is set up once: open or closed now.
  const isOpen = useRef(false);
  isOpen.current = opened !== null;

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isSaphaShortcut(event) || event.repeat) return;
      event.preventDefault();
      if (isOpen.current) close();
      else open();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

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
          onClose={close}
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

/** The element with focus now, if it is one that can take it back. */
function focused(): HTMLElement | null {
  const element = document.activeElement;
  return element instanceof HTMLElement && element !== document.body ? element : null;
}
