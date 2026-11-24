'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';

/** Counts worth a tile, in the order shown; a nought is left out. */
const TILES = [
  ['issuesDone', 'issue finished', 'issues finished'],
  ['answered', 'question answered', 'questions answered'],
  ['meetingsHeld', 'meeting held', 'meetings held'],
  ['documentsChanged', 'document changed', 'documents changed'],
  ['messages', 'message', 'messages'],
] as const;

/** "1 thread", "3 threads". */
const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The team's week, on the feed beside project health: the last seven days
 * across the whole workspace, as a few numbers and who finished most. Quiet
 * when nothing happened, so a new workspace is not shown a row of noughts.
 */
export function TeamWeek({ workspaceId }: { workspaceId: string }) {
  const week = useQuery({
    queryKey: ['team-week', workspaceId],
    queryFn: () => call(contracts['feed.week'], { params: { workspaceId } }),
    staleTime: 5 * 60_000,
  });
  if (!week.data) return null;
  const tiles = TILES.filter(([key]) => week.data[key] > 0);
  if (tiles.length === 0) return null;
  const { finishers, issuesOpened, threadsStarted } = week.data;

  return (
    <section
      aria-labelledby="team-week-heading"
      className="mt-4 rounded-xl border border-line bg-raised px-4 py-3"
    >
      <h2
        id="team-week-heading"
        className="text-xs font-semibold uppercase tracking-wide text-faint"
      >
        The team’s week
      </h2>
      <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {tiles.map(([key, one, many]) => (
          <div key={key} className="rounded-lg bg-surface px-3 py-2">
            <dt className="text-[11px] text-faint">{week.data[key] === 1 ? one : many}</dt>
            <dd className="text-lg font-semibold tabular-nums text-content">{week.data[key]}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-faint">
        {finishers.length > 0
          ? `Finishing most: ${finishers.map((f) => `${f.name} (${f.done})`).join(', ')}. `
          : ''}
        {issuesOpened > 0 ? counted(issuesOpened, 'issue opened', 'issues opened') : ''}
        {issuesOpened > 0 && threadsStarted > 0 ? ' and ' : ''}
        {threadsStarted > 0 ? counted(threadsStarted, 'thread started', 'threads started') : ''}
        {issuesOpened > 0 || threadsStarted > 0 ? ' in the last seven days.' : ''}
      </p>
    </section>
  );
}
