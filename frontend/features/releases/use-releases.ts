'use client';

import { contracts, type ResponseOf } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';

export type Release = ResponseOf<(typeof contracts)['releases.list']>['releases'][number];

export const releasesKey = (workspaceId: string) => ['releases', workspaceId] as const;

/** The workspace's releases: still to ship by the day aimed at, then shipped. */
export function useReleases(workspaceId: string) {
  return useQuery({
    queryKey: releasesKey(workspaceId),
    queryFn: () => call(contracts['releases.list'], { params: { workspaceId } }),
  });
}
