'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { getSyncEngine } from './sync.ts';

/**
 * Comments written on this device and not yet on the server (C8): queued
 * like board writes, shown as not sent yet, and sent when the network is
 * back, each exactly once (the queued id is the Idempotency-Key).
 */

/** How often to try again while something waits. */
const RETRY_MS = 5_000;

export function usePendingComments(workspaceId: string, issueId: string) {
  const client = useQueryClient();
  const pending = useQuery({
    queryKey: ['pending-comments', issueId],
    queryFn: () => getSyncEngine().pendingComments(issueId),
  });

  const refused = useQuery({
    queryKey: ['refused-comments', issueId],
    queryFn: () => getSyncEngine().refusedComments(issueId),
  });

  const sync = useCallback(async () => {
    const engine = getSyncEngine();
    await engine.flush();
    // A drain already under way may have listed the queue before this
    // comment joined it; one more pass sends it now rather than later.
    if ((await engine.pendingComments(issueId)).length > 0) await engine.flush();
    await client.invalidateQueries({ queryKey: ['pending-comments', issueId] });
    await client.invalidateQueries({ queryKey: ['refused-comments', issueId] });
    await client.invalidateQueries({ queryKey: ['comments', workspaceId, issueId] });
  }, [client, workspaceId, issueId]);

  const waiting = pending.data?.length ?? 0;
  useEffect(() => {
    const back = () => void sync();
    window.addEventListener('online', back);
    // Tried whatever the browser says about its network, which can be wrong
    // either way; a try with none fails fast and waits for the next.
    const timer = waiting > 0 ? setInterval(() => void sync(), RETRY_MS) : null;
    return () => {
      window.removeEventListener('online', back);
      if (timer) clearInterval(timer);
    };
  }, [sync, waiting]);

  const queue = useCallback(
    async (body: string) => {
      await getSyncEngine().queueComment(workspaceId, issueId, body);
      await client.invalidateQueries({ queryKey: ['pending-comments', issueId] });
      void sync();
    },
    [client, workspaceId, issueId, sync],
  );

  const dismiss = useCallback(
    async (id: string) => {
      await getSyncEngine().dismissRefused(issueId, id);
      await client.invalidateQueries({ queryKey: ['refused-comments', issueId] });
    },
    [client, issueId],
  );

  return { pending: pending.data ?? [], refused: refused.data ?? [], queue, dismiss };
}
