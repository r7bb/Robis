'use client';

import { contracts, type SEARCH_KINDS, SEARCH_LIMIT_MAX } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useEffect, useState } from 'react';
import { Highlight } from '../../../../components/ui/highlight.tsx';
import { ErrorState } from '../../../../components/ui/primitives.tsx';
import { call, type SearchHit } from '../../../../lib/api.ts';
import { hitHref, kindFromParam, searchHref } from '../../../../lib/search-links.ts';
import { lastTheme, useApplyTheme } from '../../../../lib/theme.ts';

/**
 * Search results (C1): every match for a query in this workspace, or only
 * one kind of thing, with the matched words marked in each excerpt. The
 * query and the kind live in the address, so a search can be shared.
 */

type Kind = (typeof SEARCH_KINDS)[number];

const TABS: { kind: Kind | null; label: string }[] = [
  { kind: null, label: 'All' },
  { kind: 'issue', label: 'Issues' },
  { kind: 'document', label: 'Documents' },
  { kind: 'comment', label: 'Comments' },
  { kind: 'message', label: 'Chat' },
  // Spaces: threads and the replies in them.
  { kind: 'thread', label: 'Spaces' },
  { kind: 'meeting', label: 'Meetings' },
];

const KIND_LABELS: Record<Kind, string> = {
  issue: 'Issue',
  document: 'Document',
  comment: 'Comment on',
  message: 'Chat in',
  thread: 'Thread',
  reply: 'Reply in',
  meeting: 'Meeting',
};

function SearchResults() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const q = (params.get('q') ?? '').trim();
  const type = kindFromParam(params.get('type'));

  const [input, setInput] = useState(q);
  // Back and forward change the address; the field follows it.
  useEffect(() => setInput(q), [q]);

  const workspace = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => call(contracts['workspaces.get'], { params: { workspaceId } }),
  });
  useApplyTheme(workspace.data?.workspace.theme ?? lastTheme());

  const results = useQuery({
    queryKey: ['search-page', workspaceId, q, type],
    queryFn: () =>
      call(contracts['search.workspace'], {
        params: { workspaceId },
        query: { q, limit: SEARCH_LIMIT_MAX, ...(type ? { type } : {}) },
      }),
    enabled: q.length > 0,
    staleTime: 30_000,
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    router.push(searchHref(workspaceId, input, type));
  }

  if (workspace.isError) return <ErrorState message={(workspace.error as Error).message} />;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12">
      <nav aria-label="Breadcrumb" className="text-sm text-faint">
        <Link href="/workspaces" className="hover:text-muted">
          Workspaces
        </Link>
        <span className="mx-2">/</span>
        <Link href={`/workspaces/${workspaceId}`} className="hover:text-muted">
          {workspace.data?.workspace.name ?? '…'}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-muted">Search</span>
      </nav>

      <h1 className="mt-4 text-xl font-semibold tracking-tight text-content">Search</h1>

      <form onSubmit={onSubmit} className="mt-4 flex gap-2">
        <input
          type="search"
          name="q"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          autoComplete="off"
          enterKeyHint="search"
          maxLength={200}
          placeholder="Search issues, docs, chat, spaces and meetings…"
          aria-label="Search this workspace"
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-content outline-none transition placeholder:text-faint focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
        >
          Search
        </button>
      </form>

      <nav
        aria-label="Kind of result"
        // Seven tabs outgrow a phone: the strip scrolls sideways, not the page.
        className="mt-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line [scrollbar-width:none]"
      >
        {TABS.map((tab) => {
          const current = tab.kind === type;
          return (
            <Link
              key={tab.label}
              href={searchHref(workspaceId, q, tab.kind)}
              aria-current={current ? 'page' : undefined}
              className={[
                '-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
                current
                  ? 'border-accent text-content'
                  : 'border-transparent text-muted hover:text-content',
              ].join(' ')}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <ResultList
        workspaceId={workspaceId}
        q={q}
        state={results}
        kindLabel={type ? TABS.find((t) => t.kind === type)?.label.toLowerCase() : undefined}
      />
    </main>
  );
}

function ResultList({
  workspaceId,
  q,
  state,
  kindLabel,
}: {
  workspaceId: string;
  q: string;
  state: { data?: { results: SearchHit[] }; isPending: boolean; error: unknown };
  kindLabel: string | undefined;
}) {
  const hits = state.data?.results ?? [];
  const said = q && !state.isPending && !state.error ? countLine(q, hits.length, kindLabel) : '';

  return (
    <section className="mt-6">
      {/* Always mounted, so a new count is announced. */}
      <p className="min-h-5 text-sm text-faint" aria-live="polite">
        {said}
      </p>
      {!q && (
        <p className="mt-2 text-sm text-muted">
          Search finds words in issues, documents, comments, chat, spaces and meetings, in any of
          their forms: “token” finds “tokens”. Use quotes for a phrase and a minus to leave a word
          out.
        </p>
      )}
      {q && state.isPending && <ResultSkeleton />}
      {Boolean(state.error) && (
        <p role="alert" className="mt-2 text-sm text-danger-soft">
          {(state.error as Error).message}
        </p>
      )}
      {hits.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-raised">
          {hits.map((hit) => (
            <li key={`${hit.kind}:${hit.id}`}>
              <Link
                href={hitHref(workspaceId, hit)}
                className="block px-4 py-3 transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline-none"
              >
                <span className="text-[10px] uppercase tracking-wide text-faint">
                  {KIND_LABELS[hit.kind]}
                </span>
                <span className="mt-0.5 block truncate text-sm font-medium text-content">
                  {hit.title}
                </span>
                <Highlight
                  parts={hit.parts}
                  className="mt-1 line-clamp-2 break-words text-sm text-muted"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** "12 results for “token”.", or what to say when there are none. */
function countLine(q: string, count: number, kindLabel: string | undefined): string {
  if (count === 0) return `Nothing matches “${q}”${kindLabel ? ` in ${kindLabel}` : ''}.`;
  // A full page may have more behind it, so it is not called a total.
  if (count === SEARCH_LIMIT_MAX) return `The first ${count} results for “${q}”.`;
  return `${count} ${count === 1 ? 'result' : 'results'} for “${q}”.`;
}

/** Shaped like the results it stands in for. */
function ResultSkeleton() {
  return (
    <ul aria-hidden="true" className="mt-3 divide-y divide-line rounded-lg border border-line">
      {[0, 1, 2].map((row) => (
        <li key={row} className="space-y-2 px-4 py-3">
          <div className="h-2.5 w-14 animate-pulse rounded bg-surface motion-reduce:animate-none" />
          <div className="h-3.5 w-2/3 animate-pulse rounded bg-surface motion-reduce:animate-none" />
          <div className="h-3 w-full animate-pulse rounded bg-surface motion-reduce:animate-none" />
        </li>
      ))}
    </ul>
  );
}

/** `useSearchParams` needs a boundary so the route can still be prerendered. */
export default function SearchPage() {
  return (
    <Suspense
      fallback={<main className="mx-auto max-w-3xl px-6 py-12 text-sm text-faint">Loading…</main>}
    >
      <SearchResults />
    </Suspense>
  );
}
