'use client';

import { contracts } from '@robis/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { call } from '../../lib/api.ts';
import { Generated } from './generated.tsx';
import { useAssist, waitForAnswer } from './use-assist.ts';

/**
 * Draft an agenda (D3) from the issues a meeting names by key. Shown to
 * whoever may change the meeting; the draft becomes its agenda only when
 * they press Use as agenda.
 */
export function DraftAgenda({
  workspaceId,
  meetingId,
}: {
  workspaceId: string;
  meetingId: string;
}) {
  const { available } = useAssist(workspaceId);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ask = useMutation({
    mutationFn: async () => {
      const { request } = await call(contracts['assist.agenda'], {
        params: { workspaceId },
        body: { meetingId },
      });
      return waitForAnswer(workspaceId, request.id, 'agenda');
    },
  });
  const use = useMutation({
    mutationFn: (agenda: string) =>
      call(contracts['meetings.update'], { params: { workspaceId, meetingId }, body: { agenda } }),
    onSuccess: () => {
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['meetings', workspaceId] });
    },
  });
  if (!available) return null;
  const items = ask.data?.items ?? [];
  const keyOf = new Map((ask.data?.issues ?? []).map((issue) => [issue.id, issue.key]));
  const asText = items
    .map((item) => {
      const keys = item.issueIds.map((id) => keyOf.get(id)).filter(Boolean);
      return `- ${item.text}${keys.length ? ` (${keys.join(', ')})` : ''}`;
    })
    .join('\n');

  return (
    <div className="mt-2">
      <button
        type="button"
        disabled={ask.isPending}
        onClick={() => {
          setOpen(true);
          ask.mutate();
        }}
        className="rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent-soft hover:bg-accent/20 disabled:opacity-50"
      >
        {ask.isPending ? 'Drafting…' : 'Draft agenda'}
      </button>
      {open && (ask.data || ask.error) ? (
        <Generated
          title="Draft agenda"
          onClose={() => setOpen(false)}
          actions={
            items.length > 0 ? (
              <button
                type="button"
                disabled={use.isPending}
                onClick={() => use.mutate(asText)}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
              >
                Use as agenda
              </button>
            ) : null
          }
        >
          {ask.error ? (
            <p role="alert" className="text-danger-soft">
              {ask.error instanceof Error ? ask.error.message : 'No draft this time.'}
            </p>
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-sm">
              {asText || 'Nothing to put on it.'}
            </pre>
          )}
        </Generated>
      ) : null}
    </div>
  );
}
