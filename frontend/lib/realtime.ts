'use client';

import type { ClientMessage, PresenceUser, ServerEvent, ServerMessage } from '@robis/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { realtimeUrl } from './endpoints.ts';
import { coalescer, staleKeys, uniqueKeys } from './realtime-events.ts';

/** Must stay well under the gateway's presence TTL so a single dropped beat
 * does not evict a live connection. */
const HEARTBEAT_MS = 15_000;

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 15_000;

export type ConnectionState = 'connecting' | 'live' | 'offline';

/**
 * Subscribe to a workspace's realtime feed.
 *
 * Events carry ids, not row contents, so the handler's job is to invalidate the
 * right query keys and let TanStack Query refetch through the normal authorized
 * endpoints. That keeps one authorization path instead of trusting whatever the
 * socket pushed, and it means a missed event during a reconnect is self-healing
 * -- the refetch on resubscribe brings everything current.
 */
export function useRealtime(
  workspaceId: string | null,
  location: string | null = null,
  /**
   * Called for every domain event. The board reads from the local store rather
   * than from TanStack Query, so invalidating query keys is not enough to make
   * it repaint -- it needs an explicit nudge to pull and reconcile.
   */
  onEvent?: (event: ServerEvent) => void,
  /**
   * Refetch every query when the subscription is (re)established. On for a
   * workspace page, which shows everything that could have changed; the
   * home keeps several sockets and refreshes only its own overview.
   */
  { refetchOnReady = true }: { refetchOnReady?: boolean } = {},
) {
  const queryClient = useQueryClient();
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [state, setState] = useState<ConnectionState>('connecting');

  const socketRef = useRef<WebSocket | null>(null);

  // Held in a ref so a caller passing an inline function does not tear down and
  // rebuild the socket on every render.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  // Held in a ref so the reconnect loop can read the current location without
  // being torn down and rebuilt every time the user navigates.
  const locationRef = useRef(location);
  locationRef.current = location;
  const refetchOnReadyRef = useRef(refetchOnReady);
  refetchOnReadyRef.current = refetchOnReady;

  useEffect(() => {
    if (!workspaceId) return;

    let disposed = false;
    let attempt = 0;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const send = (message: ClientMessage) => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify(message));
      }
    };

    // Events land in bursts (a teammate moving five cards); each stale key
    // is refetched once per burst rather than once per event.
    const stale = coalescer<unknown[]>((keys) => {
      for (const key of uniqueKeys(keys)) queryClient.invalidateQueries({ queryKey: key });
    });

    function handleEvent(event: ServerEvent) {
      onEventRef.current?.(event);
      for (const key of staleKeys(event)) stale.push(key);
    }

    function handleReady() {
      setState('live');
      if (locationRef.current) send({ type: 'location', location: locationRef.current });
      // Anything that changed while we were disconnected is invisible to
      // us, so treat a fresh subscription as "refetch everything".
      if (refetchOnReadyRef.current) queryClient.invalidateQueries();
    }

    function connect() {
      if (disposed) return;
      setState((current) => (current === 'live' ? 'connecting' : current));

      const socket = new WebSocket(realtimeUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        attempt = 0;
        send({ type: 'subscribe', workspaceId: workspaceId! });
      };

      socket.onmessage = (raw) => {
        const message = JSON.parse(String(raw.data)) as ServerMessage;

        switch (message.type) {
          case 'ready':
            handleReady();
            return;

          case 'presence':
            if (message.workspaceId === workspaceId) setPresence(message.users);
            return;

          case 'event':
            handleEvent(message.event);
            return;

          case 'error':
            console.warn('realtime:', message.message);
            return;
        }
      };

      socket.onclose = () => {
        if (disposed) return;
        setState('offline');
        setPresence([]);

        // Exponential backoff with jitter, so a gateway restart doesn't get a
        // synchronised stampede from every open tab.
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt++, RECONNECT_MAX_MS);
        retry = setTimeout(connect, delay + Math.random() * 250);
      };

      socket.onerror = () => socket.close();
    }

    connect();
    heartbeat = setInterval(() => send({ type: 'ping' }), HEARTBEAT_MS);

    return () => {
      disposed = true;
      stale.cancel();
      clearInterval(heartbeat);
      clearTimeout(retry);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [workspaceId, queryClient]);

  // Location changes are sent on the existing socket rather than reconnecting.
  useEffect(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({ type: 'location', location } satisfies ClientMessage),
      );
    }
  }, [location]);

  return { presence, state };
}

/**
 * A function that runs `pull` once per burst: calls within 150 ms of the
 * first become one (stage 3, item 23). For a page that pulls on events,
 * so five cards moved at once are one sync rather than five. The function
 * is the same on every render.
 */
export function useCoalesced(pull: () => void): () => void {
  const pullRef = useRef(pull);
  pullRef.current = pull;
  const batch = useMemo(() => coalescer<true>(() => pullRef.current()), []);
  useEffect(() => () => batch.cancel(), [batch]);
  return useCallback(() => batch.push(true), [batch]);
}
