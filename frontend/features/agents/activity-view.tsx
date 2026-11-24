'use client';

import { contracts, type ResponseOf } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AgentBadge } from '../../components/ui/primitives.tsx';
import { call } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/i18n/format.ts';
import { ChangeTrail } from './change-trail.tsx';

type Activity = ResponseOf<(typeof contracts)['agents.activity']>;
type Stats = ResponseOf<(typeof contracts)['suggestions.stats']>;

/**
 * Watching agents (B6), for a workspace's admins: what people did with each
 * agent's changes, its latest runs step by step, and how the composer's
 * hints fare in use. Counts come first and a share only beside them, so a
 * 100% from one change never reads like a record.
 */

const time = { format: (d: Date) => formatDateTime(d) };

function share(part: number, whole: number) {
  return whole === 0 ? '' : ` (${Math.round((part / whole) * 100)}%)`;
}

const OUTCOME_STYLE = {
  ok: 'text-emerald-300',
  denied: 'text-amber-300',
  error: 'text-rose-300',
} as const;

export function ActivityView({ workspaceId }: { workspaceId: string }) {
  const activity = useQuery({
    queryKey: ['agents-activity', workspaceId],
    queryFn: () => call(contracts['agents.activity'], { params: { workspaceId } }),
  });
  const stats = useQuery({
    queryKey: ['suggestion-stats', workspaceId],
    queryFn: () => call(contracts['suggestions.stats'], { params: { workspaceId } }),
  });

  if (activity.isError) {
    return (
      <p role="alert" className="mt-6 text-sm text-danger-soft">
        Agent activity could not be loaded. {(activity.error as Error).message}
      </p>
    );
  }
  if (!activity.data) return <p className="mt-6 text-sm text-faint">Loading…</p>;

  return (
    <div className="mt-8 space-y-12">
      <Kept agents={activity.data.agents} />
      <ChangeTrail workspaceId={workspaceId} />
      <Runs activity={activity.data} />
      {stats.data && <Hints stats={stats.data} />}
    </div>
  );
}

function Kept({ agents }: { agents: Activity['agents'] }) {
  return (
    <section aria-labelledby="kept-heading">
      <h2 id="kept-heading" className="text-sm font-medium uppercase tracking-wide text-faint">
        What people did with their changes
      </h2>
      <p className="mt-1 max-w-[62ch] text-sm text-muted">
        Each change is judged after seven days: still there is kept, changed again by a person is
        edited, set back or deleted is reverted.
      </p>
      {agents.length === 0 ? (
        <p className="mt-3 text-sm text-faint">No agents have changed anything yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-raised">
          <table className="w-full min-w-[32rem] border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-2 font-medium">Agent</th>
                <th className="px-4 py-2 font-medium">Kept</th>
                <th className="px-4 py-2 font-medium">Edited</th>
                <th className="px-4 py-2 font-medium">Reverted</th>
                <th className="px-4 py-2 font-medium" title="Younger than seven days">
                  Pending
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {agents.map((agent) => {
                const judged = agent.kept + agent.edited + agent.reverted;
                return (
                  <tr key={agent.id} className="border-t border-line">
                    <td className="border-t border-line px-4 py-2 text-content">
                      <span className="flex items-center gap-2">
                        {agent.name} <AgentBadge />
                      </span>
                    </td>
                    <td className="border-t border-line px-4 py-2 text-muted">
                      {agent.kept}
                      {share(agent.kept, judged)}
                    </td>
                    <td className="border-t border-line px-4 py-2 text-muted">
                      {agent.edited}
                      {share(agent.edited, judged)}
                    </td>
                    <td className="border-t border-line px-4 py-2 text-muted">
                      {agent.reverted}
                      {share(agent.reverted, judged)}
                    </td>
                    <td className="border-t border-line px-4 py-2 text-faint">{agent.pending}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Runs({ activity }: { activity: Activity }) {
  const [open, setOpen] = useState<string | null>(null);
  const names = new Map(activity.agents.map((agent) => [agent.id, agent.name]));

  return (
    <section aria-labelledby="runs-heading">
      <h2 id="runs-heading" className="text-sm font-medium uppercase tracking-wide text-faint">
        Latest runs
      </h2>
      <p className="mt-1 max-w-[62ch] text-sm text-muted">
        Every call an agent made here, with whether it worked, was refused, or failed, and how long
        it took. What it sent is not kept.
      </p>
      {activity.runs.length === 0 ? (
        <p className="mt-3 text-sm text-faint">No runs yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-raised">
          {activity.runs.map((run) => {
            const refused = run.steps.filter((step) => step.outcome !== 'ok').length;
            const expanded = open === run.id;
            return (
              <li key={run.id}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : run.id)}
                  className="flex w-full flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-left text-sm transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-soft"
                >
                  <span className="text-content">
                    {names.get(run.agentId) ?? 'A removed agent'}
                    <span className="ml-2 text-xs text-faint">
                      {run.source === 'triage' ? 'triage run' : 'calls'}
                    </span>
                  </span>
                  <span className="text-xs tabular-nums text-muted">
                    {run.stepCount} {run.stepCount === 1 ? 'step' : 'steps'}
                    {refused > 0 ? `, ${refused} not ok` : ''} ·{' '}
                    <time dateTime={String(run.startedAt)}>
                      {time.format(new Date(run.startedAt))}
                    </time>
                  </span>
                </button>
                {expanded && (
                  <ol className="space-y-1 border-t border-line px-4 py-3 font-mono text-xs">
                    {run.steps.map((step) => (
                      <li key={step.id} className="flex flex-wrap gap-x-3">
                        <span className="text-content">{step.tool}</span>
                        <span className={OUTCOME_STYLE[step.outcome]}>
                          {step.outcome} {step.status}
                        </span>
                        <span className="tabular-nums text-faint">{step.durationMs} ms</span>
                      </li>
                    ))}
                    {run.stepCount > run.steps.length && (
                      <li className="text-faint">and {run.stepCount - run.steps.length} more</li>
                    )}
                  </ol>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Hints({ stats }: { stats: Stats }) {
  const rows = [
    { label: 'Duplicate hints', ...stats.live.duplicate },
    { label: 'Priority suggestions', ...stats.live.priority },
  ];
  const offline = stats.offline.duplicate;

  return (
    <section aria-labelledby="hints-heading">
      <h2 id="hints-heading" className="text-sm font-medium uppercase tracking-wide text-faint">
        The composer’s hints in use
      </h2>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        {rows.map((row) => {
          const total = row.accepted + row.dismissed;
          return (
            <div key={row.label} className="rounded-lg border border-line bg-raised px-4 py-3">
              <dt className="text-xs uppercase tracking-wide text-faint">{row.label}</dt>
              <dd className="mt-1 text-sm tabular-nums text-content">
                Used {row.accepted} of {total}
                {share(row.accepted, total)}, set aside {row.dismissed}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="mt-3 max-w-[70ch] text-xs text-muted">
        A different measurement: offline, on a labelled set judged by hand, the duplicate finder at
        a threshold of {offline.threshold.toFixed(2)} was right for {offline.correctHints} of{' '}
        {offline.hints} hints (precision {offline.precision}) and found {offline.foundPairs} of{' '}
        {offline.pairs} duplicates (recall {offline.recall}). People here choosing a hint is not the
        same as a hint being right. Priority suggestions have no offline evaluation.
      </p>
    </section>
  );
}
