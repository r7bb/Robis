'use client';

import { can, contracts, type Role } from '@robis/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { call, type Member } from '../../lib/api.ts';
import { getSyncEngine } from '../../lib/sync.ts';
import { StoryComposer } from './story-composer.tsx';
import {
  byAuthor,
  hasUnseen,
  readSeen,
  type Story,
  storiesKey,
  stripOrder,
  writeSeen,
} from './story-model.ts';
import { StoryViewer } from './story-viewer.tsx';

/**
 * Stories in a workspace (B2), for anything that shows a person: the strip,
 * the rings on avatars, the viewer and the composer share one list and one
 * record of what you have seen. With stories off there is nothing here at
 * all, and the list is never asked for.
 */

type StoriesValue = {
  workspaceId: string;
  /** Whether this workspace has stories at all. */
  enabled: boolean;
  me: string | null;
  canPost: boolean;
  grouped: ReadonlyMap<string, Story[]>;
  /** Authors in the strip's order. */
  order: string[];
  /** Your photo stories saved on this device, waiting for the network. */
  waiting: number;
  unseen: (authorId: string) => boolean;
  open: (authorId: string) => void;
  compose: () => void;
};

const StoriesContext = createContext<StoriesValue | null>(null);

/** The workspace's stories, or null outside a workspace frame. */
export function useStories(): StoriesValue | null {
  return useContext(StoriesContext);
}

const NO_MEMBERS: readonly Member[] = [];

/**
 * Photo stories posted with no signal (B2) go up the moment the network is
 * back, once each (the queue's key makes a replay the same story), and the
 * strip says how many are still waiting meanwhile.
 */
function useWaitingStories(workspaceId: string, enabled: boolean, composing: boolean): number {
  const queryClient = useQueryClient();
  const [waiting, setWaiting] = useState(0);

  // The workspace this frame is on now: a count finishing after a switch is dropped.
  const current = useRef(workspaceId);
  current.current = workspaceId;

  const recount = useCallback(async () => {
    try {
      const pending = await getSyncEngine().pendingStories(workspaceId);
      if (current.current === workspaceId) setWaiting(pending.length);
    } catch {
      // The device's storage could not be read: the strip simply shows no count.
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!enabled) return;
    async function flush() {
      try {
        await getSyncEngine().flush();
      } catch {
        // Left queued; the next reconnect or visit tries again.
      }
      await recount();
      await queryClient.invalidateQueries({ queryKey: storiesKey(workspaceId) });
    }
    // Once on opening, in case some were left from a visit with no signal.
    void flush();
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, [enabled, workspaceId, recount, queryClient]);

  // The composer closing is when a new one may have been saved.
  useEffect(() => {
    if (enabled && !composing) void recount();
  }, [enabled, composing, recount]);

  return waiting;
}

/** Given what the frame has loaded; until it has, there are no stories. */
export function StoriesProvider({
  workspaceId,
  workspace,
  me: account,
  members = NO_MEMBERS,
  children,
}: {
  workspaceId: string;
  workspace: { storiesEnabled: boolean; role: Role } | undefined;
  me: { id: string } | undefined;
  members: readonly Member[] | undefined;
  children: ReactNode;
}) {
  const enabled = workspace?.storiesEnabled ?? false;
  const role = workspace?.role;
  const me = account?.id ?? null;
  const list = useQuery({
    queryKey: storiesKey(workspaceId),
    queryFn: () => call(contracts['stories.list'], { params: { workspaceId } }),
    enabled,
    // Expiry is the server's to judge; a minute keeps the strip close to it
    // between the live events that refresh it at once.
    refetchInterval: 60_000,
  });
  const stories = useMemo(() => (enabled ? (list.data?.stories ?? []) : []), [enabled, list.data]);

  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (me) setSeen(readSeen(me));
  }, [me]);

  const [viewing, setViewing] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const waiting = useWaitingStories(workspaceId, enabled, composing);

  const grouped = useMemo(() => byAuthor(stories), [stories]);
  const order = useMemo(() => stripOrder(grouped, seen, me), [grouped, seen, me]);

  // Mirrored in a ref, so marking one seen reads the latest set without a
  // side effect inside a state update.
  const seenNow = useRef(seen);
  seenNow.current = seen;
  const markSeen = useCallback(
    (storyId: string) => {
      if (seenNow.current.has(storyId)) return;
      const next = new Set([...seenNow.current, storyId]);
      seenNow.current = next;
      setSeen(next);
      if (me) writeSeen(me, next, stories);
    },
    [me, stories],
  );
  const closeViewer = useCallback(() => setViewing(null), []);
  const closeComposer = useCallback(() => setComposing(false), []);

  const value = useMemo<StoriesValue>(
    () => ({
      workspaceId,
      enabled,
      me,
      canPost: enabled && role !== undefined && can(role, 'story:create'),
      grouped,
      order,
      waiting,
      unseen: (authorId) => hasUnseen(grouped.get(authorId) ?? [], seen),
      open: (authorId) => {
        if (grouped.has(authorId)) setViewing(authorId);
      },
      compose: () => setComposing(true),
    }),
    [workspaceId, enabled, me, role, grouped, order, waiting, seen],
  );

  const names = useMemo(() => new Map(members.map((member) => [member.userId, member])), [members]);

  return (
    <StoriesContext.Provider value={value}>
      {children}
      {viewing && grouped.has(viewing) ? (
        <StoryViewer
          workspaceId={workspaceId}
          startAuthor={viewing}
          order={order}
          grouped={grouped}
          seen={seen}
          people={names}
          me={me}
          role={role}
          onSeen={markSeen}
          onClose={closeViewer}
        />
      ) : null}
      {composing ? <StoryComposer workspaceId={workspaceId} onClose={closeComposer} /> : null}
    </StoriesContext.Provider>
  );
}
