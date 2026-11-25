'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { call } from '../../lib/api.ts';
import { localToday } from '../../lib/due-date.ts';
import { boardHref, issueHref } from '../../lib/links.ts';
import { addedLine, carriedChip, daysLeftLine } from '../cycles/cycle-days.ts';
import { cyclesOn } from './cycle-answer-model.ts';

const UNDER_WAY = new Set(['IN_PROGRESS', 'IN_REVIEW']);

/**
 * How the cycle running now is going, on the board named or on each board
 * with one: done of planned, the days left, and the first few issues still
 * open, work under way marked, each a link.
 */
export function CycleAnswer({
  workspaceId,
  board,
  onClose,
}: {
  workspaceId: string;
  board: string | null;
  onClose: () => void;
}) {
  const today = localToday();
  const answer = useQuery({
    queryKey: ['cycles-current', workspaceId, today],
    queryFn: () => call(contracts['cycles.current'], { params: { workspaceId }, query: { today } }),
    retry: false,
  });
  if (answer.isPending) return <p className="text-sm text-faint">Looking…</p>;
  if (answer.isError) {
    return (
      <p role="alert" className="text-sm text-danger-soft">
        {(answer.error as Error).message}
      </p>
    );
  }
  const found = cyclesOn(answer.data.cycles, board);
  if (found.length === 0) {
    return (
      <p role="status" className="text-base text-content">
        {board ? `No cycle is running on ${board} today.` : 'No board has a cycle running today.'}
      </p>
    );
  }

  return (
    <div role="status" className="space-y-4">
      {found.map((cycle) => {
        const counted = cycle.total - cycle.canceled;
        const left = cycle.total - cycle.done - cycle.canceled;
        return (
          <div key={cycle.id} className="space-y-1.5">
            <p className="text-base text-content">
              {cycle.name}
              <span className="text-sm text-faint"> on {cycle.projectName}</span>
            </p>
            <p className="text-sm text-muted">
              {cycle.done} of {counted} done · {daysLeftLine(today, cycle.endsOn)}
              {addedLine(cycle.added)}
              {left > 0 ? ` · ${left} still open` : ''}
            </p>
            {cycle.open.length > 0 ? (
              <ul className="space-y-1">
                {cycle.open.map((issue) => (
                  <li key={issue.id} className="text-sm">
                    <Link
                      href={issueHref(workspaceId, issue.id)}
                      onClick={onClose}
                      className="text-content hover:underline"
                    >
                      <span className="mr-1.5 font-mono text-xs text-faint">{issue.key}</span>
                      {issue.title}
                      {UNDER_WAY.has(issue.status) ? (
                        <span className="ml-1.5 text-xs text-faint">under way</span>
                      ) : null}
                      {issue.carriedOver > 0 ? (
                        <span className="ml-1.5 text-xs text-amber-300">
                          {carriedChip(issue.carriedOver, false)}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            <Link
              href={boardHref(workspaceId, cycle.projectId, { filter: { cycleId: cycle.id } })}
              onClick={onClose}
              className="inline-block text-sm text-accent-soft hover:underline"
            >
              Show this cycle
            </Link>
          </div>
        );
      })}
    </div>
  );
}
