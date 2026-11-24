'use client';

import { contracts } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';
import { feedKey } from './feed-model.ts';

/**
 * Following and muting someone (a quieter feed): whose posts the Following
 * tab shows, and whose the Everyone tab leaves out. Both are yours alone;
 * nobody is told.
 */

const followsKey = (workspaceId: string) => ['follows', workspaceId] as const;

export function useFollows(workspaceId: string) {
  const query = useQuery({
    queryKey: followsKey(workspaceId),
    queryFn: () => call(contracts['follows.list'], { params: { workspaceId } }),
  });
  return {
    following: new Set(query.data?.following ?? []),
    muted: new Set(query.data?.muted ?? []),
    ready: query.isSuccess,
  };
}

function useToggle(workspaceId: string, userId: string, kind: 'follow' | 'mute') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) => {
      const name =
        kind === 'follow'
          ? on
            ? 'follows.follow'
            : 'follows.unfollow'
          : on
            ? 'follows.mute'
            : 'follows.unmute';
      return call(contracts[name], { params: { workspaceId, userId } });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: followsKey(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: feedKey(workspaceId) });
    },
  });
}

const QUIET =
  'rounded-full border px-2.5 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-50';

export function FollowButton({
  workspaceId,
  userId,
  name,
  size = 'sm',
  onlyToFollow = false,
}: {
  workspaceId: string;
  userId: string;
  name: string;
  size?: 'sm' | 'md';
  /** Show nothing once followed, where a "Following" would only be noise. */
  onlyToFollow?: boolean;
}) {
  const { following, ready } = useFollows(workspaceId);
  const toggle = useToggle(workspaceId, userId, 'follow');
  if (!ready) return null;
  const on = following.has(userId);
  if (on && onlyToFollow && !toggle.isPending) return null;
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `Following ${name}` : `Follow ${name}`}
      disabled={toggle.isPending}
      onClick={() => toggle.mutate(!on)}
      className={`${QUIET} ${size === 'md' ? 'px-3 py-1.5 text-sm' : ''} ${
        on
          ? 'border-line text-muted hover:text-content'
          : 'border-accent/40 bg-accent/10 font-medium text-accent-soft hover:bg-accent/20'
      }`}
    >
      {on ? 'Following' : 'Follow'}
    </button>
  );
}

export function MuteButton({
  workspaceId,
  userId,
  name,
}: {
  workspaceId: string;
  userId: string;
  name: string;
}) {
  const { muted, ready } = useFollows(workspaceId);
  const toggle = useToggle(workspaceId, userId, 'mute');
  if (!ready) return null;
  const on = muted.has(userId);
  return (
    <button
      type="button"
      aria-pressed={on}
      // The visible word starts each name, so speech control finds it (WCAG 2.5.3).
      aria-label={on ? `Muted: ${name}, press to show again` : `Mute ${name} on your feed`}
      disabled={toggle.isPending}
      onClick={() => toggle.mutate(!on)}
      className={`${QUIET} px-3 py-1.5 text-sm border-line text-muted hover:text-content`}
    >
      {on ? 'Muted' : 'Mute'}
    </button>
  );
}
