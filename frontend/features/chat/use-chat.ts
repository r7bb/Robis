'use client';

import { contracts } from '@robis/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';
import type { ChatMessage, MessagePage } from './types.ts';

/**
 * Data access for chat.
 *
 * Kept apart from the components so the rendering code is about layout and
 * this file is about caching. It also means the query keys live in one place
 * -- they are a contract with `lib/realtime.ts`, which invalidates them by
 * name from a long way away, and a typo there fails silently.
 */

function channelsKey(workspaceId: string) {
  return ['channels', workspaceId] as const;
}

function messagesKey(workspaceId: string, channelId: string) {
  return ['messages', workspaceId, channelId] as const;
}

export function useChannels(workspaceId: string) {
  return useQuery({
    queryKey: channelsKey(workspaceId),
    queryFn: () => call(contracts['channels.list'], { params: { workspaceId } }),
  });
}

/**
 * Chat history, paged backwards.
 *
 * The server returns newest-first, which is the order a chat window needs its
 * first page in. Each further page is older, so the flattened result is
 * reverse-chronological and the view reverses it once for display rather
 * than re-sorting on every render.
 */
export function useMessages(workspaceId: string, channelId: string | null) {
  return useInfiniteQuery({
    queryKey: messagesKey(workspaceId, channelId ?? 'none'),
    enabled: channelId !== null,
    initialPageParam: undefined as string | undefined,
    // Only runs once a channel is chosen (`enabled` above).
    queryFn: ({ pageParam }) =>
      call(contracts['messages.list'], {
        params: { workspaceId, channelId: channelId as string },
        query: { cursor: pageParam },
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Oldest-first, which is the order they are read in. */
export function flattenMessages(pages: MessagePage[] | undefined): ChatMessage[] {
  if (!pages) return [];

  return pages.flatMap((page) => page.messages).reverse();
}

export function useSendMessage(workspaceId: string, channelId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: string) =>
      call(contracts['messages.create'], {
        params: { workspaceId, channelId: channelId as string },
        body: { body },
      }),
    /*
     * No optimistic insert.
     *
     * The sender is subscribed to the same realtime feed as everyone else, so
     * their own message arrives through the socket within a frame or two of
     * the response. An optimistic row would have to be reconciled against
     * that arrival by id, and getting it wrong shows the message twice --
     * a visible bug traded for latency nobody can perceive on a local
     * network. Offline is covered by the mutation queue, not by this.
     */
    onSuccess: () => {
      if (!channelId) return;
      queryClient.invalidateQueries({ queryKey: messagesKey(workspaceId, channelId) });
    },
  });
}

export function useCreateChannel(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) =>
      call(contracts['channels.create'], { params: { workspaceId }, body: { name } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: channelsKey(workspaceId) }),
  });
}

export function useDeleteMessage(workspaceId: string, channelId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (messageId: string) =>
      call(contracts['messages.delete'], { params: { workspaceId, messageId } }),
    onSuccess: () => {
      if (!channelId) return;
      queryClient.invalidateQueries({ queryKey: messagesKey(workspaceId, channelId) });
    },
  });
}
