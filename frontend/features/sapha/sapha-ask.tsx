'use client';

import { contracts, intentFromParts, LOOKING_INTENTS, type SaphaIntent } from '@robis/shared';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { call } from '../../lib/api.ts';
import { waitForAnswer } from '../assist/use-assist.ts';
import { placeOf } from './run-intent.ts';
import type { Proposal } from './use-sapha-command.ts';

/**
 * Asking the assistant what a request means (Sapha, tier 1), shown in the
 * palette while it reads. Only the words typed are sent. What comes back is
 * checked as tier 0's reading is, then goes where a look goes, or to the
 * same card that waits for Do it.
 */
export function SaphaAsk({
  workspaceId,
  request,
  onIntent,
  onBack,
  onClose,
}: {
  workspaceId: string;
  request: string;
  onIntent: (intent: Proposal) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const ask = useMutation({
    mutationFn: async (): Promise<SaphaIntent> => {
      const { request: made } = await call(contracts['assist.interpret'], {
        params: { workspaceId },
        body: { request },
      });
      const { parts } = await waitForAnswer(workspaceId, made.id, 'intent');
      const intent = intentFromParts(parts, new Date());
      if (!intent) throw new Error('Sapha could not read that as something to do here.');
      return intent;
    },
    onSuccess: async (intent) => {
      if (!LOOKING_INTENTS.has(intent.kind)) return onIntent(intent as Proposal);
      const href = await placeOf(workspaceId, intent as Exclude<SaphaIntent, Proposal>).catch(
        () => null,
      );
      onClose();
      if (href) router.push(href);
    },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: asked once, when shown.
  useEffect(() => ask.mutate(), []);

  return (
    <section
      aria-label="Sapha"
      className="space-y-3 p-4"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onBack();
      }}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">Sapha</p>
      <p className="text-sm text-muted">“{request}”</p>
      {ask.isError ? (
        <p role="alert" className="text-sm text-danger-soft">
          {(ask.error as Error).message}
        </p>
      ) : (
        <p role="status" className="text-sm text-faint">
          Reading that with the assistant…
        </p>
      )}
      <p className="text-xs text-faint">
        Only these words are sent to the workspace’s assistant. Nothing changes until you say so.
      </p>
      <button
        type="button"
        onClick={onBack}
        className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-surface hover:text-content"
      >
        Back
      </button>
    </section>
  );
}
