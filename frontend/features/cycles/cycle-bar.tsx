'use client';

import { contracts } from '@robis/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { call } from '../../lib/api.ts';
import { localToday } from '../../lib/due-date.ts';
import { LeftOverLine } from './left-over-line.tsx';
import { currentCycle, cyclesKey, useCycles } from './use-cycles.ts';

const DAY_MS = 86_400_000;
/** A new cycle is this long unless changed. */
const DEFAULT_DAYS = 14;

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function daysLeft(today: string, endsOn: string): number {
  return Math.round(
    (Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS,
  );
}

/**
 * The board's current cycle (or the next), as a bar of what is done, with
 * the days left and a way to show only its issues; and for planning, a new
 * cycle from today, two weeks unless changed.
 */
export function CycleBar({
  workspaceId,
  projectId,
  canPlan,
  showingOnly,
  onShowOnly,
}: {
  workspaceId: string;
  projectId: string;
  canPlan: boolean;
  /** The cycle the board is filtered to, if any. */
  showingOnly: string | undefined;
  onShowOnly: (cycleId: string | undefined) => void;
}) {
  const cycles = useCycles(workspaceId, projectId);
  const [planning, setPlanning] = useState(false);
  const today = localToday();
  const cycle = currentCycle(cycles.data?.cycles ?? [], today);
  if (!cycle && !canPlan) return null;

  return (
    <div className="mt-3 rounded-lg border border-line bg-raised px-3 py-2">
      {cycle ? (
        <CycleProgress
          cycle={cycle}
          today={today}
          showingOnly={showingOnly === cycle.id}
          onToggle={() => onShowOnly(showingOnly === cycle.id ? undefined : cycle.id)}
        />
      ) : (
        <p className="text-xs text-faint">No cycle planned on this board.</p>
      )}
      <LeftOverLine
        workspaceId={workspaceId}
        projectId={projectId}
        cycles={cycles.data?.cycles ?? []}
        today={today}
        canPlan={canPlan}
      />
      {canPlan ? (
        planning ? (
          <PlanCycle
            workspaceId={workspaceId}
            projectId={projectId}
            today={today}
            count={cycles.data?.cycles.length ?? 0}
            onDone={() => setPlanning(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlanning(true)}
            className="mt-1 rounded px-1 text-[11px] text-muted hover:text-content"
          >
            Plan a cycle
          </button>
        )
      ) : null}
    </div>
  );
}

function CycleProgress({
  cycle,
  today,
  showingOnly,
  onToggle,
}: {
  cycle: NonNullable<ReturnType<typeof currentCycle>>;
  today: string;
  showingOnly: boolean;
  onToggle: () => void;
}) {
  const counted = cycle.total - cycle.canceled;
  const share = counted > 0 ? Math.round((cycle.done / counted) * 100) : 0;
  const running = cycle.startsOn <= today;
  const left = daysLeft(today, cycle.endsOn);
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-content">{cycle.name}</span>
        <span className="text-faint">
          {running
            ? left === 0
              ? 'ends today'
              : `${left} ${left === 1 ? 'day' : 'days'} left`
            : `starts ${cycle.startsOn}`}
          {' · '}
          {cycle.done} of {counted} done
        </span>
        <button
          type="button"
          aria-pressed={showingOnly}
          onClick={onToggle}
          className="rounded px-1.5 py-0.5 text-[11px] text-muted hover:text-content"
        >
          {showingOnly ? 'Show every issue' : 'Only this cycle'}
        </button>
      </div>
      <div aria-hidden="true" className="mt-1.5 h-1 rounded-full bg-surface">
        <div className="h-full rounded-full bg-accent" style={{ width: `${share}%` }} />
      </div>
    </div>
  );
}

function PlanCycle({
  workspaceId,
  projectId,
  today,
  count,
  onDone,
}: {
  workspaceId: string;
  projectId: string;
  today: string;
  count: number;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(`Cycle ${count + 1}`);
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(addDays(today, DEFAULT_DAYS - 1));
  const plan = useMutation({
    mutationFn: () =>
      call(contracts['cycles.create'], {
        params: { workspaceId, projectId },
        body: { name: name.trim(), startsOn, endsOn },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: cyclesKey(workspaceId, projectId) });
      onDone();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) plan.mutate();
  }

  const field =
    'rounded-md border border-line bg-surface px-2 py-1 text-xs text-content outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60';
  return (
    <form
      onSubmit={submit}
      aria-label="Plan a cycle"
      className="mt-2 flex flex-wrap items-center gap-2"
    >
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        aria-label="Name"
        maxLength={80}
        className={`${field} w-28`}
      />
      <input
        type="date"
        value={startsOn}
        onChange={(event) => setStartsOn(event.target.value)}
        aria-label="Starts"
        className={field}
      />
      <input
        type="date"
        value={endsOn}
        onChange={(event) => setEndsOn(event.target.value)}
        aria-label="Ends"
        className={field}
      />
      <button
        type="submit"
        disabled={plan.isPending || !name.trim()}
        className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
      >
        Plan it
      </button>
      <button type="button" onClick={onDone} className="text-xs text-faint hover:text-content">
        Cancel
      </button>
      {plan.isError ? (
        <p role="alert" className="basis-full text-xs text-danger-soft">
          {(plan.error as Error).message}
        </p>
      ) : null}
    </form>
  );
}
