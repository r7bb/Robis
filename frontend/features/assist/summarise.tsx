'use client';

import { contracts, type ResponseOf } from '@robis/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { call } from '../../lib/api.ts';
import { Generated } from './generated.tsx';
import { useAssist, waitForAnswer } from './use-assist.ts';

/**
 * Summarise (D3): a button that asks for a summary of an issue's comments
 * or a channel's recent messages, and shows the points, each with numbered
 * links to what it came from. Shows only where assistance is on.
 */

type Points = Extract<
  NonNullable<ResponseOf<(typeof contracts)['assist.result']>['result']>,
  { kind: 'summary' }
>['points'];

/** Each source numbered once, in the order the points first cite it. */
function numberSources(points: Points): Map<string, number> {
  const order = new Map<string, number>();
  for (const point of points) {
    for (const source of point.sources) if (!order.has(source)) order.set(source, order.size + 1);
  }
  return order;
}

function Points({
  points,
  sourceHref,
}: {
  points: Points;
  sourceHref: (sourceId: string) => string;
}) {
  if (points.length === 0) return <p className="text-muted">Nothing to summarise yet.</p>;
  const order = numberSources(points);
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {points.map((point) => (
        <li key={point.text}>
          {point.text}{' '}
          {point.sources.map((source) => (
            <a
              key={source}
              href={sourceHref(source)}
              className="ml-0.5 align-super text-[10px] text-accent-soft hover:underline"
              aria-label={`Source ${order.get(source)}`}
            >
              [{order.get(source)}]
            </a>
          ))}
        </li>
      ))}
    </ul>
  );
}

export function Summarise({
  workspaceId,
  kind,
  id,
  sourceHref,
}: {
  workspaceId: string;
  kind: 'issue' | 'channel';
  id: string;
  /** Where a source points: a comment's or a message's place on the page. */
  sourceHref: (sourceId: string) => string;
}) {
  const { available } = useAssist(workspaceId);
  const [open, setOpen] = useState(false);
  const ask = useMutation({
    mutationFn: async () => {
      const { request } = await call(contracts['assist.summary'], {
        params: { workspaceId },
        body: { kind, id },
      });
      return waitForAnswer(workspaceId, request.id, 'summary');
    },
  });
  if (!available) return null;
  const done = open && (ask.data || ask.error);

  return (
    <div>
      <button
        type="button"
        disabled={ask.isPending}
        onClick={() => {
          setOpen(true);
          ask.mutate();
        }}
        className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-medium text-accent-soft hover:bg-accent/20 disabled:opacity-50"
      >
        {ask.isPending ? 'Summarising…' : 'Summarise'}
      </button>
      {done ? (
        <Generated title="Summary" onClose={() => setOpen(false)}>
          {ask.error ? (
            <p role="alert" className="text-danger-soft">
              {ask.error instanceof Error ? ask.error.message : 'No summary this time.'}
            </p>
          ) : (
            <Points points={ask.data?.points ?? []} sourceHref={sourceHref} />
          )}
        </Generated>
      ) : null}
    </div>
  );
}
