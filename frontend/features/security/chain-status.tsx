'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/primitives.tsx';
import { api, type ChainReport } from '../../lib/api.ts';

/** Enough of a hash to compare by eye; the full value is one click away. */
const SHORT_HASH = 12;

type Report = { isPending: boolean; isError: boolean; error: unknown; data?: ChainReport };

function headline({ isPending, isError, data }: Report): string {
  if (isPending) return 'Checking the chain…';
  if (isError || !data) return 'The chain could not be checked';
  // A key this server lacks is a reason to look, not proof of an edit.
  if (data.broken?.reason === 'unverifiable') return `Cannot check event ${data.broken.seq}`;
  if (data.broken?.reason === 'unsigned') return 'This trail carries no signature';
  if (!data.ok) return `Broken at event ${data.broken?.seq}`;
  const events = `${data.checked} ${data.checked === 1 ? 'event' : 'events'}`;
  if (data.fromSeq > 0) return `No break found in ${events} since the last check`;
  return `No break found in all ${events}`;
}

function explanation({ isError, error, data }: Report): string {
  if (isError) return (error as Error).message;
  if (data && !data.ok && data.broken) return data.broken.detail;
  if (data?.checkpoint === 'rejected') {
    return 'The stored checkpoint did not match its signature, so the whole trail was checked from the first event. Someone may have changed it in the database.';
  }
  if (data?.checkpoint === 'stale') {
    return 'The event the last check ended on has changed since, so the whole trail was checked from the first event.';
  }
  if (data && data.fromSeq > 0) {
    return `Checked from event #${data.fromSeq}, where the last check ended; that point is stored with a signature. Events before it were checked then, and a full check walks them all again.`;
  }
  return 'Each event carries a hash of itself and of the one before it, signed with a key the database does not hold, so changing or removing one breaks the chain where it happened, and rewriting the rest needs that key. Dropping the newest events leaves no break; the copy below, or the SIEM stream, is what catches that.';
}

function toneOf(data: ChainReport | undefined): string {
  if (!data) return 'border-line';
  return data.ok ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-danger/50 bg-danger/10';
}

/**
 * Whether the trail is intact, said plainly.
 *
 * The head hash is offered for copying because the chain alone cannot catch
 * the newest rows being dropped, or a rewrite by someone who also holds the
 * signing key. A head someone wrote down earlier -- or the SIEM receiver's
 * copy -- can.
 */
export function ChainStatus({ workspaceId }: { workspaceId: string }) {
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();
  const key = ['audit-verify', workspaceId];
  const check = (full: boolean) =>
    api<ChainReport>(`/workspaces/${workspaceId}/audit/verify${full ? '?full=1' : ''}`, {
      method: 'POST',
    });

  // One result on screen, whichever kind of check produced it: a full check
  // replaces it, and "Check again" always runs a new quick one.
  const report = useQuery({
    queryKey: key,
    queryFn: () => check(false),
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

  const fullCheck = useMutation({
    mutationFn: () => check(true),
    onSuccess: (result) => queryClient.setQueryData(key, result),
  });

  const data = report.data;

  return (
    <section aria-live="polite" className={`rounded-lg border p-4 ${toneOf(data)}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-content">{headline(report)}</h2>

          <p className="mt-1 max-w-[62ch] text-sm text-muted">{explanation(report)}</p>
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => report.refetch()}
            disabled={report.isFetching || fullCheck.isPending}
          >
            {report.isFetching ? 'Checking…' : 'Check again'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => fullCheck.mutate()}
            disabled={report.isFetching || fullCheck.isPending}
            title="Walk every event from the first, ignoring the checkpoint"
          >
            {fullCheck.isPending ? 'Checking all…' : 'Full check'}
          </Button>
        </div>
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
