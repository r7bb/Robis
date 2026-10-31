'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';
import { useDebounced } from '../../lib/use-debounced.ts';

/** Below this, a title is too short to say anything about. */
export const MIN_LENGTH = 12;

/** Long enough that a typist is not firing a request per keystroke. */
export const DEBOUNCE_MS = 400;

/** The query key both hints share: one request per workspace and settled title. */
export function suggestionsKey(workspaceId: string, settled: string) {
  return ['suggestions', workspaceId, settled] as const;
}

/**
 * The composer's hints for a draft title (stage 3, item 27): possible
 * duplicates and a suggested priority, from one request. The duplicate and
 * priority hints both call this with the same title, settle it the same
 * way and so share one cached answer; neither repeats the request.
 */
export function useSuggestions(workspaceId: string, title: string) {
  const settled = useDebounced(title.trim(), DEBOUNCE_MS);
  const longEnough = settled.length >= MIN_LENGTH;

  const { data } = useQuery({
    queryKey: suggestionsKey(workspaceId, settled),
    enabled: longEnough,
    queryFn: () =>
      call(contracts['issues.suggestions'], {
        params: { workspaceId },
        query: { title: settled },
      }),
    // A hint is not worth retrying for, and a stale answer for a title the
    // writer has moved past is worse than none.
    retry: false,
    staleTime: 60_000,
  });

  return {
    longEnough,
    similar: longEnough ? (data?.similar ?? []) : [],
    suggestion: longEnough ? (data?.suggestion ?? null) : null,
  };
}
