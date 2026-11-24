'use client';

import { contracts } from '@robis/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';
import { leftOver } from './left-over.ts';
import { type Cycle, cyclesKey } from './use-cycles.ts';

/**
 * When the last cycle ended with issues still open, a line saying how many
 * and, for those who plan, one press to move them into the cycle running
 * now (or the next one).
 */
export function LeftOverLine({
  workspaceId,
  projectId,
  cycles,
  today,
  canPlan,
}: {
  workspaceId: string;
  projectId: string;
  cycles: readonly Cycle[];
  today: string;
  canPlan: boolean;
}) {
  const queryClient = useQueryClient();
  const found = leftOver(cycles, today);
  const move = useMutation({
    mutationFn: (job: { fromId: string; toId: string }) =>
      call(contracts['cycles.rollover'], {
        params: { workspaceId, cycleId: job.fromId },
        body: { toCycleId: job.toId },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: cyclesKey(workspaceId, projectId) }),
  });
  if (!found) return null;
  const { from, to, unfinished } = found;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2 text-[11px]">
      <span className="text-muted">
        {from.name} ended with {unfinished} {unfinished === 1 ? 'issue' : 'issues'} unfinished.
      </span>
      {canPlan ? (
        <button
          type="button"
          disabled={move.isPending}
          onClick={() => move.mutate({ fromId: from.id, toId: to.id })}
          className="rounded px-1.5 py-0.5 font-medium text-accent-soft hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-soft disabled:opacity-50"
        >
          Move {unfinished === 1 ? 'it' : 'them'} to {to.name}
        </button>
      ) : null}
      {move.isError ? (
        <span role="alert" className="text-danger-soft">
          {(move.error as Error).message}
        </span>
      ) : null}
    </div>
  );
}
