'use client';

import { contracts } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { call } from '../../../lib/api.ts';
import { stillAnswering } from './turn-model.ts';

/**
 * Sapha's conversations, from the page (the agent): the list, one
 * conversation read again every second while an answer is on its way, and
 * saying something, which starts a conversation or adds to one.
 */

/** How often a conversation is read while Sapha is answering. */
const WHILE_ANSWERING_MS = 1000;

const conversationsKey = (workspaceId: string) => ['sapha-conversations', workspaceId] as const;
const conversationKey = (workspaceId: string, conversationId: string | null) =>
  ['sapha-conversation', workspaceId, conversationId] as const;

export function useConversations(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: conversationsKey(workspaceId),
    queryFn: () => call(contracts['sapha.conversations'], { params: { workspaceId } }),
    enabled,
  });
}

export function useConversation(workspaceId: string, conversationId: string | null) {
  return useQuery({
    queryKey: conversationKey(workspaceId, conversationId),
    queryFn: () =>
      call(contracts['sapha.conversation'], {
        params: { workspaceId, conversationId: conversationId! },
      }),
    enabled: Boolean(conversationId),
    refetchInterval: (query) =>
      stillAnswering(query.state.data?.turns ?? []) ? WHILE_ANSWERING_MS : false,
  });
}

/** Say something: a new conversation when there is none yet, else the next turn of this one. */
export function useSay(
  workspaceId: string,
  conversationId: string | null,
  onConversation: (id: string) => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (text: string) => {
      if (conversationId) {
        await call(contracts['sapha.say'], {
          params: { workspaceId, conversationId },
          body: { text },
        });
        return conversationId;
      }
      const started = await call(contracts['sapha.start'], {
        params: { workspaceId },
        body: { text },
      });
      return started.conversation.id;
    },
    onSuccess: async (id) => {
      onConversation(id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: conversationKey(workspaceId, id) }),
        queryClient.invalidateQueries({ queryKey: conversationsKey(workspaceId) }),
      ]);
    },
  });
}

export function useForget(workspaceId: string, onForgotten: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string | 'all') =>
      conversationId === 'all'
        ? call(contracts['sapha.forgetAll'], { params: { workspaceId } })
        : call(contracts['sapha.forget'], { params: { workspaceId, conversationId } }),
    onSuccess: async () => {
      onForgotten();
      await queryClient.invalidateQueries({ queryKey: conversationsKey(workspaceId) });
    },
  });
}
