'use client';

import { contracts, type ResponseOf } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';

export const assistKey = (workspaceId: string) => ['assist', workspaceId] as const;

/**
 * Whether assistance (D3) is on here: an admin turned it on, and the server
 * has a key. Every button that asks for something shows only when both are
 * true, so a workspace without it looks exactly as it did.
 */
export function useAssist(workspaceId: string) {
  const status = useQuery({
    queryKey: assistKey(workspaceId),
    queryFn: () => call(contracts['assist.status'], { params: { workspaceId } }),
    staleTime: 60_000,
  });
  return {
    available: Boolean(status.data?.enabled && status.data.keyed),
    enabled: status.data?.enabled ?? false,
    keyed: status.data?.keyed ?? false,
    loaded: status.isSuccess,
  };
}

type Result = NonNullable<ResponseOf<(typeof contracts)['assist.result']>['result']>;

const POLL_MS = 1_000;
/** About a minute: past that, the worker is not coming back to this one. */
const POLL_TRIES = 60;

/**
 * Wait for an ask's answer: the worker, the one part that talks to the
 * provider, writes it back, and this reads it every second for a minute.
 * Throws with a plain message when the ask failed or took too long.
 */
export async function waitForAnswer<K extends Result['kind']>(
  workspaceId: string,
  requestId: string,
  kind: K,
): Promise<Extract<Result, { kind: K }>> {
  for (let i = 0; i < POLL_TRIES; i++) {
    const { status, result } = await call(contracts['assist.result'], {
      params: { workspaceId, requestId },
    });
    if (status === 'done' && result?.kind === kind) return result as Extract<Result, { kind: K }>;
    if (status === 'failed') throw new Error('Nothing came back this time. Try again later.');
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error('That is taking too long. Try again later.');
}
