'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';

/**
 * "You may already have filed this."
 *
 * Shown under the issue composer while somebody types a title. Advisory in
 * the strongest sense: it never blocks the form, never preselects anything,
 * and disappears the moment the text stops matching. The worst outcome here
 * is not a missed duplicate, it is a writer who stops trusting the hint and
 * starts ignoring the panel.
 *
 * Everything degrades to showing nothing. The endpoint answers with an
 * empty list when the ML service is unconfigured or unreachable, and the
 * query below treats an error the same way, so a composer in a deployment
 * without `relay-ml` looks exactly as it did before this existed.
 */

/** Below this, a title is too short to say anything about. */
const MIN_LENGTH = 12;

/** Long enough that a typist is not firing a request per keystroke. */
const DEBOUNCE_MS = 400;

type SimilarIssue = { id: string; title: string; score: number };

/**
 * The title, but only after the typing stops.
 *
 * A debounce rather than a per-keystroke query: this runs while somebody is
 * mid-sentence, and the answer for a half-written word is both wasted and
 * distracting.
 */
function useDebounced(value: string, delayMs: number): string {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}

export function DuplicateHints({ workspaceId, title }: { workspaceId: string; title: string }) {
  const settled = useDebounced(title.trim(), DEBOUNCE_MS);
  const longEnough = settled.length >= MIN_LENGTH;

  const { data } = useQuery({
    queryKey: ['similar', workspaceId, settled],
    enabled: longEnough,
    queryFn: () =>
      api<{ similar: SimilarIssue[] }>(
        `/workspaces/${workspaceId}/issues/similar?title=${encodeURIComponent(settled)}`,
      ),
    // A hint is not worth retrying for, and a stale answer for a title the
    // writer has moved past is worse than none.
    retry: false,
    staleTime: 60_000,
  });

  const similar = data?.similar ?? [];
  if (!longEnough || similar.length === 0) return null;

  return (
    <aside
      // Polite, not assertive: this appears while somebody is typing, and an
      // assertive region would interrupt them mid-word.
      aria-live="polite"
      className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.07] p-3"
    >
      <p className="text-xs font-medium text-amber-200">
        {similar.length === 1 ? 'A similar issue already exists' : 'Similar issues already exist'}
      </p>

      <ul className="mt-2 space-y-1">
        {similar.map((issue) => (
          <li key={issue.id}>
            <Link
              href={`/workspaces/${workspaceId}/issues/${issue.id}`}
              className="flex items-baseline justify-between gap-3 rounded px-2 py-1 text-sm text-muted transition-colors duration-[--micro] ease-[--ease] hover:bg-amber-400/10 hover:text-content"
            >
              <span className="truncate">{issue.title}</span>

              {/* The score is shown rather than hidden behind a threshold,
                  so a reader can tell a near-certain duplicate from a loose
                  match instead of trusting the ranking blindly. */}
              <span className="shrink-0 font-mono text-[10px] text-faint">
                {Math.round(issue.score * 100)}% match
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}
