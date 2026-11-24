'use client';

import { contracts, type ResponseOf } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';

export type Cycle = ResponseOf<(typeof contracts)['cycles.list']>['cycles'][number];

export const cyclesKey = (workspaceId: string, projectId: string) =>
  ['cycles', workspaceId, projectId] as const;

/** A board's cycles, earliest first, with how their issues stand. */
export function useCycles(workspaceId: string, projectId: string) {
  return useQuery({
    queryKey: cyclesKey(workspaceId, projectId),
    queryFn: () => call(contracts['cycles.list'], { params: { workspaceId, projectId } }),
  });
}

/** The cycle running on `today`, else the next to start, else none. */
export function currentCycle(cycles: readonly Cycle[], today: string): Cycle | null {
  return (
    cycles.find((c) => c.startsOn <= today && today <= c.endsOn) ??
    cycles.find((c) => c.startsOn > today) ??
    null
  );
}
