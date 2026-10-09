'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/primitives.tsx';
import { api, type ChainReport } from '../../lib/api.ts';

/** Enough of a hash to compare by eye; the full value is one click away. */
const SHORT_HASH = 12;

type Report = { isPending: boolean; isError: boolean; error: unknown; data?: ChainReport };

function headline({ isPending, isError, data }: Report): string {
  if (isPending) return 'Checking the chain…';
  if (isError || !data) return 'The chain could not be checked';
  if (!data.ok) return `Broken at event ${data.broken?.seq}`;
  return `No break found in ${data.checked} ${data.checked === 1 ? 'event' : 'events'}`;
}

function explanation({ isError, error, data }: Report): string {
  if (isError) return (error as Error).message;
  if (data && !data.ok && data.broken) return data.broken.detail;
  return 'Each event carries a hash of itself and of the one before it, so changing or removing one breaks the chain where it happened. Someone with direct database access could rewrite everything after an edit consistently; the copy below, or the SIEM stream, is what catches that.';
}

function toneOf(data: ChainReport | undefined): string {
  if (!data) return 'border-line';
  return data.ok ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-danger/50 bg-danger/10';
}

/**
 * Whether the trail is intact, said plainly.
 *
 * The head hash is offered for copying because the chain alone cannot catch
 * a rewrite of everything after an edit, or the newest rows being dropped.
 * A head someone wrote down earlier -- or the SIEM receiver's copy -- can.
 */
export function ChainStatus({ workspaceId }: { workspaceId: string }) {
  const [copied, setCopied] = useState(false);

  const report = useQuery({
    queryKey: ['audit-verify', workspaceId],
    queryFn: () => api<ChainReport>(`/workspaces/${workspaceId}/audit/verify`),
    // A check walks and hashes the whole trail, and the API rate-limits it.
    // It runs when the page opens and when someone asks, not on every focus.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    retry: false,
  });

  async function copyHead(hash: string) {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the hash is still on screen.
      setCopied(false);
    }
  }

  const data = report.data;

  return (
    <section aria-live="polite" className={`rounded-lg border p-4 ${toneOf(data)}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-content">{headline(report)}</h2>

          <p className="mt-1 max-w-[62ch] text-sm text-muted">{explanation(report)}</p>
        </div>

        <Button size="sm" onClick={() => report.refetch()} disabled={report.isFetching}>
          {report.isFetching ? 'Checking…' : 'Check again'}
        </Button>
      </div>

      {data?.head ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-faint">
          <span>Head</span>
          <code
            title={data.head.hash}
            className="rounded bg-raised px-1.5 py-0.5 font-mono text-muted"
          >
            #{data.head.seq} · {data.head.hash.slice(0, SHORT_HASH)}
          </code>
          <button
            type="button"
            onClick={() => copyHead(data.head!.hash)}
            className="rounded px-1 text-accent-soft hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <span className="basis-full sm:basis-auto">
            Keep a copy elsewhere. If event #{data.head.seq} later shows a different hash, history
            was rewritten.
          </span>
        </div>
      ) : null}
    </section>
  );
}
