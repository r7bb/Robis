'use client';

import type { Avatar, IssueStatus } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.ts';

/** `GET /workspaces/overview`, as `backend/api/src/routes/overview.ts` sends it. */
export type WorkspaceOverview = {
  id: string;
  openIssues: number;
  memberCount: number;
  members: { id: string; name: string; avatar: Avatar }[];
  /** Fourteen days, oldest first; the last is today. */
  activity: number[];
  latest: {
    kind: 'issue.created' | 'comment.created';
    actorName: string | null;
    issueId: string;
    issueTitle: string;
    at: string;
  } | null;
};

export type AssignedIssue = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  key: string;
  title: string;
  status: IssueStatus;
  updatedAt: string;
};

export type Overview = {
  workspaces: WorkspaceOverview[];
  /** The five most recently touched. */
  assigned: AssignedIssue[];
  /** All of them, which the hero says. */
  assignedTotal: number;
};

export const OVERVIEW_KEY = ['workspaces', 'overview'] as const;

export function useOverview(enabled: boolean) {
  return useQuery({
    queryKey: OVERVIEW_KEY,
    queryFn: () => api<Overview>('/workspaces/overview'),
    enabled,
    // Several tiles connecting at once should not each refetch it.
    staleTime: 5_000,
  });
}
