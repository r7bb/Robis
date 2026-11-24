'use client';

import { contracts } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { call } from '../../lib/api.ts';

/** Other rooms are counted again this often: their messages are not pushed to this tab. */
const UNREAD_POLL_MS = 30_000;
const DAY_MS = 86_400_000;

/** Each room's unread count, by room id. */
export function useUnread(workspaceId: string): ReadonlyMap<string, number> {
  const reads = useQuery({
    queryKey: ['channel-reads', workspaceId],
    queryFn: () => call(contracts['channels.unread'], { params: { workspaceId } }),
    refetchInterval: UNREAD_POLL_MS,
  });
  return new Map((reads.data?.rooms ?? []).map((room) => [room.channelId, room.unread]));
}

/**
 * Where "New" goes in the open room: how far you had read when you opened
 * it, held while you stay, and the room marked read while it is in view
 * (on opening, and as messages arrive with the tab showing).
 */
export function useReadPlace(
  workspaceId: string,
  channelId: string | null,
  newestId: string | undefined,
): string | null {
  const queryClient = useQueryClient();
  const [since, setSince] = useState<{ channelId: string; at: string | null } | null>(null);
  const held = useRef<string | null>(null);
  const mark = useMutation({
    mutationFn: (id: string) =>
      call(contracts['channels.markRead'], { params: { workspaceId, channelId: id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['channel-reads', workspaceId] }),
  });

  // The place as it was on opening, read once per room.
  useEffect(() => {
    if (!channelId || held.current === channelId) return;
    held.current = channelId;
    void call(contracts['channels.unread'], { params: { workspaceId } }).then(({ rooms }) => {
      const room = rooms.find((r) => r.channelId === channelId);
      // Never read: the last day counts as new, as the count does.
      const neverRead = new Date(Date.now() - DAY_MS).toISOString();
      setSince({ channelId, at: room && room.unread > 0 ? (room.lastReadAt ?? neverRead) : null });
    });
  }, [workspaceId, channelId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: marked on opening and on each newest message, not on every render of the mutation.
  useEffect(() => {
    if (!channelId || !newestId) return;
    const markIfShown = () => {
      if (document.visibilityState === 'visible') mark.mutate(channelId);
    };
    markIfShown();
    document.addEventListener('visibilitychange', markIfShown);
    return () => document.removeEventListener('visibilitychange', markIfShown);
  }, [channelId, newestId]);

  return since && since.channelId === channelId ? since.at : null;
}
