'use client';

import { describeIntent, type SaphaIntent } from '@robis/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { useMyId } from '../../lib/use-people.ts';
import { runIntent } from './run-intent.ts';

type Change = Exclude<SaphaIntent, { kind: 'open' | 'search' | 'go' | 'blockers' }>;

/**
 * What Sapha is about to do, and nothing done until Do it (Sapha, tier 0).
 * It acts as the person, through their own access, and says so; Escape or
 * Not now goes back to the list.
 */
export function SaphaCard({
  workspaceId,
  intent,
  onBack,
  onClose,
}: {
  workspaceId: string;
  intent: Change;
  onBack: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const myId = useMyId();
  const confirm = useRef<HTMLButtonElement>(null);
  const run = useMutation({
    mutationFn: () => runIntent(workspaceId, intent, myId),
    // Whatever it changed is shown fresh wherever it appears.
    onSuccess: () => queryClient.invalidateQueries(),
  });

  useEffect(() => confirm.current?.focus(), []);

  return (
    <section
      aria-label="Sapha"
      className="space-y-3 p-4"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        if (run.isSuccess) onClose();
        else onBack();
      }}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">Sapha</p>
      <p className="text-base text-content">{describeIntent(intent)}</p>
      {run.isSuccess ? (
        <div role="status" className="flex items-center gap-3 text-sm text-muted">
          <span>{run.data.said}</span>
          {run.data.href ? (
            <Link
              href={run.data.href}
              onClick={onClose}
              className="text-accent-soft hover:underline"
            >
              Open
            </Link>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-xs text-faint hover:text-content"
          >
            Close
          </button>
        </div>
      ) : (
        <>
          <p className="text-xs text-faint">
            Done as you, with your access. Nothing changes until you say so.
          </p>
          {run.isError ? (
            <p role="alert" className="text-sm text-danger-soft">
              {(run.error as Error).message}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              ref={confirm}
              type="button"
              disabled={run.isPending}
              onClick={() => run.mutate()}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
            >
              {run.isPending ? 'Doing it…' : 'Do it'}
            </button>
            <button
              type="button"
              onClick={onBack}
              className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-surface hover:text-content"
            >
              Not now
            </button>
          </div>
        </>
      )}
    </section>
  );
}
