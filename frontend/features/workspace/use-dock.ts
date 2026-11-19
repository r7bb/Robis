'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * The chat dock's size and whether it is open: kept on this device, so the
 * workspace opens the way it was left. Read after the first paint, as the
 * server cannot know it; until then the dock shows only its bar.
 */

const STORAGE_KEY = 'robis.chat-dock';
const DOCK_DEFAULT_HEIGHT = 300;
export const DOCK_MIN_HEIGHT = 160;
/** The board keeps at least this share of the column. */
const DOCK_MAX_SHARE = 0.7;
/** One arrow press on the handle. */
export const DOCK_STEP = 24;

type DockState = { open: boolean; height: number };

const DEFAULT_STATE: DockState = { open: true, height: DOCK_DEFAULT_HEIGHT };

function read(): DockState {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<DockState>;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_STATE;
    return {
      open: typeof parsed.open === 'boolean' ? parsed.open : DEFAULT_STATE.open,
      height: typeof parsed.height === 'number' ? parsed.height : DEFAULT_STATE.height,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

/** The tallest the dock may be in a window this tall. */
function dockMaxHeight(viewport: number): number {
  return Math.max(DOCK_MIN_HEIGHT, Math.floor(viewport * DOCK_MAX_SHARE));
}

/** Within the limits for a window this tall. */
export function clampDockHeight(height: number, viewport: number): number {
  return Math.min(Math.max(Math.round(height), DOCK_MIN_HEIGHT), dockMaxHeight(viewport));
}

/** Ctrl and the backquote key, as a code editor's terminal opens. */
export function isDockShortcut(event: KeyboardEvent): boolean {
  return event.ctrlKey && !event.altKey && !event.metaKey && event.code === 'Backquote';
}

/** The window's height, kept current, once there is a window. */
function useViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setHeight(window.innerHeight);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return height;
}

export function useDock() {
  const [state, setState] = useState<DockState | null>(null);
  const viewport = useViewportHeight();

  useEffect(() => setState(read()), []);

  // Saved after each change rather than while making it: a drag is many
  // changes, and a state updater should not write anywhere.
  useEffect(() => {
    if (!state) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Private mode: the dock still works, it is just not remembered.
    }
  }, [state]);

  const setOpen = useCallback(
    (open: boolean) => setState((previous) => ({ ...(previous ?? DEFAULT_STATE), open })),
    [],
  );
  const setHeight = useCallback(
    (height: number) =>
      setState(() => ({ open: true, height: clampDockHeight(height, window.innerHeight) })),
    [],
  );

  const height = state && viewport ? clampDockHeight(state.height, viewport) : DOCK_DEFAULT_HEIGHT;
  return {
    /** False until the saved state is read, so a closed dock never flashes open. */
    open: state?.open ?? false,
    height,
    maxHeight: viewport ? dockMaxHeight(viewport) : DOCK_DEFAULT_HEIGHT,
    setOpen,
    setHeight,
  };
}
