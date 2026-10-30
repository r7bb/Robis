'use client';

import { contracts, type ResponseOf } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';

/** `GET /workspaces/overview`, as its contract describes it. */
export type Overview = ResponseOf<(typeof contracts)['workspaces.overview']>;

export type WorkspaceOverview = Overview['workspaces'][number];

export type AssignedIssue = Overview['assigned'][number];

export const OVERVIEW_KEY = ['workspaces', 'overview'] as const;

export function useOverview(enabled: boolean) {
  return useQuery({
    queryKey: OVERVIEW_KEY,
    queryFn: () => call(contracts['workspaces.overview']),
    enabled,
    // Several tiles connecting at once should not each refetch it.
    staleTime: 5_000,
  });
}
