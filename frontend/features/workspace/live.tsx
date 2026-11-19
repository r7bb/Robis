'use client';

import type { PresenceUser, ServerEvent } from '@robis/shared';
import { createContext, type ReactNode, useContext, useEffect, useRef } from 'react';
import type { ConnectionState } from '../../lib/realtime.ts';

/**
 * The workspace's one live connection, shared by everything in the frame:
 * the board in the middle and the chat docked below it hear the same
 * socket, rather than each opening its own.
 */

export type Live = {
  presence: PresenceUser[];
  state: ConnectionState;
  /** Hear every event; the returned function stops. */
  subscribe: (listener: (event: ServerEvent) => void) => () => void;
};

const LiveContext = createContext<Live | null>(null);

export function LiveProvider({ value, children }: { value: Live; children: ReactNode }) {
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): Live {
  const live = useContext(LiveContext);
  if (!live) throw new Error('useLive outside the workspace frame');
  return live;
}

/** Run `handler` for each event, always the latest one passed. */
export function useLiveEvents(handler: (event: ServerEvent) => void) {
  const { subscribe } = useLive();
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => subscribe((event) => latest.current(event)), [subscribe]);
}
