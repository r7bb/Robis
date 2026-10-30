'use client';

import type { Avatar } from '@robis/shared';
import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import { call } from './api.ts';

const NO_AVATARS: ReadonlyMap<string, Avatar> = new Map();

/**
 * Every member's picture in the current workspace, by user id.
 *
 * Shares the `['members', workspaceId]` cache with the roster and the Team
 * tab, so a board card, a comment or a presence chip costs no extra request.
 * Outside a workspace route it is simply empty and everyone shows initials.
 */
export function useMemberAvatars(): ReadonlyMap<string, Avatar> {
  const { workspaceId } = useParams<{ workspaceId?: string }>();

  const members = useQuery({
    queryKey: ['members', workspaceId],
    // Only runs once there is a workspace on the route (`enabled` below).
    queryFn: () =>
      call(contracts['members.list'], { params: { workspaceId: workspaceId as string } }),
    enabled: Boolean(workspaceId),
  });

  // One Map per fetched member list, not per render, so consumers that
  // memoise on it are not invalidated by every keystroke or presence ping.
  return useMemo(
    () =>
      members.data
        ? new Map(members.data.members.map((member) => [member.userId, member.avatar]))
        : NO_AVATARS,
    [members.data],
  );
}
