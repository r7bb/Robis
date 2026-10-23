'use client';

import type { PresenceUser, ServerEvent } from '@robis/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ConnectionState } from '../../lib/realtime.ts';
import type { FieldMode } from '../landing/field-modes.ts';
import { describeEvent, type FeedItem, feedItemFrom, othersHere } from './describe.ts';
import { OVERVIEW_KEY, type Overview } from './use-overview.ts';
import type { TileSignals } from './workspace-tile.tsx';

/** Lines kept in the live feed. */
const FEED_MAX = 8;
/** A burst of events refreshes the counts once, shortly after it settles. */
const REFRESH_AFTER_MS = 800;

function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** The feed before anything happens live: the last thing in each workspace. */
function seedFeed(overview: Overview, workspaceNames: ReadonlyMap<string, string>): FeedItem[] {
  return overview.workspaces
    .flatMap((w) => {
      if (!w.latest) return [];
      const at = new Date(w.latest.at).getTime();
      const event = {
        type: w.latest.kind,
        workspaceId: w.id,
        issueId: w.latest.issueId,
        actorId: '',
      } as ServerEvent;
      const text = describeEvent(event, w.latest.actorName);
      if (!text) return [];
      return [
        {
          id: `seed-${w.id}`,
          workspaceId: w.id,
          workspaceName: workspaceNames.get(w.id) ?? 'a workspace',
          text,
          href: `/workspaces/${w.id}/issues/${w.latest.issueId}`,
          at,
        },
      ];
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, FEED_MAX);
}

/**
 * The home's live state, fed by each tile's connection to the gateway:
 * who is here, the feed, the field's ring count and its mode.
 */
export function useHomeLive({
  myId,
  overview,
  workspaceNames,
}: {
  myId: string;
  overview: Overview | undefined;
  workspaceNames: ReadonlyMap<string, string>;
}) {
  const queryClient = useQueryClient();
  const [presence, setPresence] = useState<
    Record<string, { users: PresenceUser[]; state: ConnectionState }>
  >({});
  const [pulse, setPulse] = useState(0);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const seeded = useRef(false);
  const refresh = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Names for live events, which carry only ids: members from the overview,
  // and anyone connected.
  const names = useMemo(() => {
    const byId = new Map<string, string>();
    for (const w of overview?.workspaces ?? []) {
      for (const m of w.members) byId.set(m.id, m.name);
    }
    for (const { users } of Object.values(presence)) {
      for (const u of users) byId.set(u.userId, u.name);
    }
    return byId;
  }, [overview, presence]);

  const context = useRef({ names, workspaceNames });
  context.current = { names, workspaceNames };
  const [everConnected, setEverConnected] = useState(false);

  /** A burst of events, or a reconnect, refreshes the counts once. */
  const scheduleRefresh = useCallback(() => {
    clearTimeout(refresh.current);
    refresh.current = setTimeout(
      () => queryClient.invalidateQueries({ queryKey: OVERVIEW_KEY }),
      REFRESH_AFTER_MS,
    );
  }, [queryClient]);

  const signals = useMemo<TileSignals>(
    () => ({
      onEvent(event) {
        setPulse((n) => n + 1);
        const item = feedItemFrom(event, {
          actorName: context.current.names.get(event.actorId) ?? null,
          workspaceName: context.current.workspaceNames.get(event.workspaceId) ?? 'a workspace',
          at: Date.now(),
        });
        if (item) setFeed((list) => [item, ...list].slice(0, FEED_MAX));
        scheduleRefresh();
      },
      onPresence(workspaceId, users, state) {
        setPresence((all) => {
          // Back from offline: what changed meanwhile is not in the counts.
          if (all[workspaceId]?.state === 'offline' && state === 'live') scheduleRefresh();
          return { ...all, [workspaceId]: { users, state } };
        });
        if (state === 'live') setEverConnected(true);
      },
      onGone(workspaceId) {
        setPresence(({ [workspaceId]: _gone, ...rest }) => rest);
      },
    }),
    [scheduleRefresh],
  );

  useEffect(() => () => clearTimeout(refresh.current), []);

  // Once both have arrived, so the lines name their workspaces.
  useEffect(() => {
    if (seeded.current || !overview || workspaceNames.size === 0) return;
    seeded.current = true;
    setFeed(seedFeed(overview, workspaceNames));
  }, [overview, workspaceNames]);

  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const others = othersHere(
    myId,
    Object.values(presence).map((p) => p.users),
  );
  const states = Object.values(presence).map((p) => p.state);
  const offline = !online || (states.length > 0 && states.every((s) => s === 'offline'));
  const mode: FieldMode = offline ? 'offline' : others.length > 0 ? 'realtime' : 'idle';

  return {
    signals,
    pulse,
    // A deleted workspace's lines go with it.
    feed: feed.filter((item) => workspaceNames.has(item.workspaceId)),
    others,
    mode,
    connected: states.some((s) => s === 'live'),
    everConnected,
  };
}
