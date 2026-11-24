'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { call, type SearchHit } from '../lib/api.ts';
import { hitHref, searchHref } from '../lib/search-links.ts';
import { Highlight } from './ui/highlight.tsx';

/** Wait this long after typing stops before querying. */
const DEBOUNCE_MS = 200;

const KIND_LABELS: Record<SearchHit['kind'], string> = {
  issue: 'Issue',
  document: 'Document',
  comment: 'Comment',
  message: 'Chat',
  thread: 'Thread',
  reply: 'Reply in',
  meeting: 'Meeting',
};

/** `trailing` sits inside the field's right edge: the shell puts the palette's shortcut there. */
export function SearchBox({
  workspaceId,
  trailing,
}: {
  workspaceId: string;
  trailing?: ReactNode;
}) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const router = useRouter();

  // Debounce so a full-text query does not run on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const results = useQuery({
    queryKey: ['search', workspaceId, query],
    queryFn: () =>
      call(contracts['search.workspace'], { params: { workspaceId }, query: { q: query } }),
    enabled: query.length > 0,
    // Results for a given query do not change often, and re-running a
    // full-text search on every focus is wasteful.
    staleTime: 30_000,
  });

  const hits = results.data?.results ?? [];

  return (
    <div ref={containerRef} className="relative">
      <SearchIcon />
      {/* `text-ellipsis` so a box narrower than its placeholder ends in "…"
          rather than a word sliced in half. */}
      <input
        type="search"
        name="q"
        autoComplete="off"
        enterKeyHint="search"
        value={input}
        onChange={(event) => {
          setInput(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Enter opens every result, on the results page.
        onKeyDown={(event) => {
          // Not while an input method is still composing: that Enter confirms a word.
          if (event.key !== 'Enter' || event.nativeEvent.isComposing || !input.trim()) return;
          setOpen(false);
          router.push(searchHref(workspaceId, input));
        }}
        placeholder="Search issues, docs and comments…"
        aria-label="Search this workspace"
        className={`w-full text-ellipsis rounded-md border border-line bg-surface py-2 pl-9 ${trailing ? 'pr-16' : 'pr-3'} text-sm text-content outline-none transition placeholder:text-faint focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60 [&::-webkit-search-cancel-button]:hidden`}
      />
      {trailing && (
        <div className="absolute right-1.5 top-[1.125rem] -translate-y-1/2">{trailing}</div>
      )}

      {/* The live region is always mounted. One that appears together with
          its content is often not announced at all. */}
      <div aria-live="polite">
        {open && query.length > 0 && (
          <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-lg border border-line bg-raised shadow-xl">
            {results.isPending ? (
              <p className="px-4 py-4 text-sm text-faint">Searching…</p>
            ) : hits.length === 0 ? (
              <p className="px-4 py-4 text-sm text-faint">Nothing matches “{query}”.</p>
            ) : (
              <ul className="max-h-96 divide-y divide-line overflow-y-auto">
                {hits.map((hit) => (
                  <li key={`${hit.kind}:${hit.id}`}>
                    <Link
                      href={hitHref(workspaceId, hit)}
                      onClick={() => setOpen(false)}
                      className="block px-4 py-3 hover:bg-surface"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm text-content">{hit.title}</span>
                        <span className="shrink-0 text-[10px] uppercase tracking-wide text-faint">
                          {KIND_LABELS[hit.kind]}
                        </span>
                      </div>

                      <Highlight
                        parts={hit.parts}
                        className="mt-1 line-clamp-2 text-xs text-faint"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href={searchHref(workspaceId, query)}
              onClick={() => setOpen(false)}
              className="block border-t border-line px-4 py-2.5 text-xs text-muted hover:bg-surface hover:text-content"
            >
              All results for “{query}”
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

/** Drawn to match `TrashIcon` in `delete-button.tsx`: same grid, same stroke. */
function SearchIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
    >
      <circle cx="7" cy="7" r="4.25" />
      <path d="m10.25 10.25 3.25 3.25" />
    </svg>
  );
}
