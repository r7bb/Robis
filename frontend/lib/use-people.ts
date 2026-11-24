'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { call } from './api.ts';

/** The workspace's members, as a list and by id, for names and faces. */
export function usePeople(workspaceId: string) {
  const members = useQuery({
    queryKey: ['members', workspaceId],
    queryFn: () => call(contracts['members.list'], { params: { workspaceId } }),
  });
  const list = members.data?.members;
  const people = useMemo(
    () => new Map((list ?? []).map((member) => [member.userId, member])),
    [list],
  );
  return { list: list ?? [], people };
}

/** The signed-in person's id, or null while it loads. */
export function useMyId(): string | null {
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => call(contracts['auth.me']),
    retry: false,
  });
  return me.data?.user.id ?? null;
}
