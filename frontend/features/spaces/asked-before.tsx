'use client';

import { contracts } from '@robis/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { call } from '../../lib/api.ts';
import { threadHref } from '../../lib/links.ts';
import { useDebounced } from '../../lib/use-debounced.ts';
import { SolvedChip } from './solved-chip.tsx';

/** Wait this long after typing stops, as search does. */
const DEBOUNCE_MS = 400;
/** Shorter than this, a title has too few words to compare. */
const TITLE_MIN = 10;

/**
 * Asked before? Under a draft title, threads anywhere in the workspace that
 * share its words, answered ones first, each opening in a new tab so the
 * draft is kept. Nothing shows until there is something to show.
 */
export function AskedBefore({ workspaceId, title }: { workspaceId: string; title: string }) {
  const typed = useDebounced(title.trim(), DEBOUNCE_MS);
  const similar = useQuery({
    queryKey: ['similar-threads', workspaceId, typed],
    queryFn: () =>
      call(contracts['spaces.similar'], { params: { workspaceId }, query: { q: typed } }),
    enabled: typed.length >= TITLE_MIN,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const threads = typed.length >= TITLE_MIN ? (similar.data?.threads ?? []) : [];

  return (
    <div aria-live="polite">
      {threads.length > 0 ? (
        <section className="mt-2 rounded-lg border border-line bg-surface px-3 py-2">
          <h3 className="text-xs font-medium text-muted">Asked before?</h3>
          <ul className="mt-1 space-y-1">
            {threads.map((thread) => (
              <li key={thread.id} className="flex items-baseline gap-2 text-sm">
                <Link
                  href={threadHref(workspaceId, thread.id)}
                  target="_blank"
                  className="min-w-0 truncate text-content hover:text-accent-soft hover:underline"
                >
                  {thread.title}
                </Link>
                <span className="shrink-0 text-xs text-faint">
                  {thread.solved ? (
                    <SolvedChip />
                  ) : (
                    `${thread.replyCount} ${thread.replyCount === 1 ? 'reply' : 'replies'}`
                  )}{' '}
                  · {thread.spaceName}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
