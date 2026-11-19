'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * The chat panel's width and whether it is open: kept on this device, so
 * the workspace opens the way it was left. Read after the first paint, as
 * the server cannot know it; until then the panel stays shut, so one left
 * closed never flashes open.
 */

const STORAGE_KEY = 'robis.chat-panel';
const DEFAULT_WIDTH = 360;
export const CHAT_MIN_WIDTH = 300;
/** The board keeps at least this share of the window. */
const MAX_SHARE = 0.5;
/** One arrow press on the edge. */
export const CHAT_STEP = 24;

type PanelState = { open: boolean; width: number };

const DEFAULT_STATE: PanelState = { open: true, width: DEFAULT_WIDTH };

function read(): PanelState {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<PanelState>;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_STATE;
    return {
      open: typeof parsed.open === 'boolean' ? parsed.open : DEFAULT_STATE.open,
      width: typeof parsed.width === 'number' ? parsed.width : DEFAULT_STATE.width,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

/** The widest the panel may be in a window this wide. */
function chatMaxWidth(viewport: number): number {
  return Math.max(CHAT_MIN_WIDTH, Math.floor(viewport * MAX_SHARE));
}

/** Within the limits for a window this wide. */
export function clampChatWidth(width: number, viewport: number): number {
  return Math.min(Math.max(Math.round(width), CHAT_MIN_WIDTH), chatMaxWidth(viewport));
}

/** Ctrl and the backquote key, as a code editor's side panel opens. */
export function isChatShortcut(event: KeyboardEvent): boolean {
  return event.ctrlKey && !event.altKey && !event.metaKey && event.code === 'Backquote';
}

/** The window's width, kept current, once there is a window. */
function useViewportWidth(): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return width;
}

/** Below this the panel covers the board instead of sitting beside it. */
const SIDE_BY_SIDE = 1024;

export function useChatPanel() {
  const [state, setState] = useState<PanelState | null>(null);
  // On a narrow screen open or shut is for now, held apart from the saved
  // choice, so a visit on a small window does not change the wide one. It
  // starts shut there, as open it would cover the board. Null: as saved.
  const [forNow, setForNow] = useState<boolean | null>(null);
  const viewport = useViewportWidth();

  useEffect(() => {
    setState(read());
    if (window.innerWidth < SIDE_BY_SIDE) setForNow(false);
  }, []);

  // Saved after each change rather than while making it: a drag is many
  // changes, and a state updater should not write anywhere.
  useEffect(() => {
    if (!state) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Private mode: the panel still works, it is just not remembered.
    }
  }, [state]);

  const setOpen = useCallback((open: boolean) => {
    if (window.innerWidth < SIDE_BY_SIDE) return setForNow(open);
    setForNow(null);
    setState((previous) => ({ ...(previous ?? DEFAULT_STATE), open }));
  }, []);
  const setWidth = useCallback(
    (width: number) =>
      setState(() => ({ open: true, width: clampChatWidth(width, window.innerWidth) })),
    [],
  );

  return {
    /** False until the saved state is read, so the frame can keep the panel's room. */
    ready: state !== null,
    open: state !== null && (forNow ?? state.open),
    width: state && viewport ? clampChatWidth(state.width, viewport) : DEFAULT_WIDTH,
    maxWidth: viewport ? chatMaxWidth(viewport) : DEFAULT_WIDTH,
    /** Beside the board, or over it on a narrow screen. */
    overlay: viewport !== null && viewport < SIDE_BY_SIDE,
    setOpen,
    setWidth,
  };
}
