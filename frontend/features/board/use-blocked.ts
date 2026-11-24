'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';

const NONE: ReadonlySet<string> = new Set();

/** The board's issues that still wait on an issue not yet done or canceled. */
export function useBlocked(workspaceId: string, projectId: string): ReadonlySet<string> {
  const blocked = useQuery({
    queryKey: ['project-blocked', workspaceId, projectId],
    queryFn: () => call(contracts['projects.blocked'], { params: { workspaceId, projectId } }),
    staleTime: 30_000,
  });
  return blocked.data ? new Set(blocked.data.issueIds) : NONE;
}
