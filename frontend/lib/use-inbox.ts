'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { call } from './api.ts';

/**
 * How often the inbox is asked again. Notifications are made by a worker, so
 * there is no live event to wait for: the job may land seconds after the comment.
 */
const POLL_MS = 20_000;

/**
 * The signed-in person's notifications, as the bell and the home's Mentions
 * card both read them: one query, so the two never disagree or poll twice.
 */
export function useInbox() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => call(contracts['notifications.list']),
    refetchInterval: POLL_MS,
    retry: false,
  });
}
