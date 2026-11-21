'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { call } from '../../lib/api.ts';
import { boardHref } from '../../lib/links.ts';
import {
  durationLabel,
  type Flow,
  flowKey,
  type ProjectFlow,
  plural,
  sampleNote,
  spreadSentence,
  untimedNote,
} from './flow-model.ts';
import { ThroughputBars } from './throughput-bars.tsx';

/**
 * How long work takes and how much gets done (Phase 6), a card per active
 * project, worked out from the status changes in the audit trail when the
 * page opens and kept live by the board's own events. A project with too
 * few finished issues says so in counts rather than drawing a guess.
 */
export function InsightsView({ workspaceId }: { workspaceId: string }) {
  const flow = useQuery({
    queryKey: flowKey(workspaceId),
    queryFn: () => call(contracts['insights.flow'], { params: { workspaceId } }),
  });

  if (flow.isPending) return <FlowSkeleton />;
  if (!flow.data) {
    return (
      <p role="alert" className="text-sm text-muted">
        The figures could not be worked out just now. Try again in a moment.
      </p>
    );
  }
  if (flow.data.projects.length === 0) {
    return (
      <p className="text-sm text-muted">
        No active projects yet. Figures appear here once issues start moving to done.
      </p>
    );
  }

  return (
    <section aria-labelledby="flow-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="flow-heading" className="text-sm font-semibold text-content">
          Cycle time and throughput
        </h2>
        <p className="text-xs text-faint">Last {flow.data.weeks} weeks, from status changes</p>
      </div>
      {flow.isError ? (
        <p role="status" className="mt-2 text-xs text-muted">
          These could not be refreshed just now, so they are the last figures worked out.
        </p>
      ) : null}
      <ul className="mt-3 space-y-2.5">
        {flow.data.projects.map((project) => (
          <li key={project.id}>
            <FlowCard workspaceId={workspaceId} project={project} flow={flow.data} />
          </li>
        ))}
      </ul>
      <HowItIsWorkedOut minSample={flow.data.minSample} />
    </section>
  );
}

function FlowCard({
  workspaceId,
  project,
  flow,
}: {
  workspaceId: string;
  project: ProjectFlow;
  flow: Flow;
}) {
  const note = sampleNote(project, flow);
  const untimed = untimedNote(project);
  return (
    <article className="rounded-xl border border-line bg-raised p-4">
      <header className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-medium leading-tight text-content">
          <Link
            href={boardHref(workspaceId, project.id)}
            className="block truncate rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
          >
            {project.name}
          </Link>
          <span className="font-mono text-[11px] font-normal text-faint">{project.key}</span>
        </p>
        <p className="shrink-0 text-xs tabular-nums text-muted">
          {plural(project.finished, 'issue')} finished
        </p>
      </header>

      {project.cycleTime || project.throughput ? (
        <div className="mt-4 grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          {project.cycleTime ? (
            <div className="min-w-0">
              <p className="text-xs text-faint">Median cycle time</p>
              <p className="mt-0.5 text-2xl font-semibold tracking-tight tabular-nums text-content">
                {durationLabel(project.cycleTime.medianSeconds)}
              </p>
              <p className="mt-1 text-pretty text-xs leading-relaxed text-muted">
                {spreadSentence(project.cycleTime)} From {plural(project.measured, 'issue')}.
              </p>
            </div>
          ) : (
            <p className="text-pretty text-xs leading-relaxed text-muted">{note}</p>
          )}
          {project.throughput ? (
            <ThroughputBars counts={project.throughput} since={flow.since} />
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-pretty text-xs leading-relaxed text-muted">{note}</p>
      )}
      {untimed ? <p className="mt-2 text-xs text-faint">{untimed}</p> : null}
    </article>
  );
}

/** The rules behind the numbers, for anyone who wants to check them. */
function HowItIsWorkedOut({ minSample }: { minSample: number }) {
  return (
    <details className="group mt-5 rounded-lg text-xs text-muted">
      <summary className="cursor-pointer rounded-sm text-faint underline-offset-4 hover:text-muted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft">
        How these are worked out
      </summary>
      <ul className="mt-2 max-w-[65ch] list-disc space-y-1 pl-5 leading-relaxed">
        <li>
          An issue is finished at its last move to done, and counts only while it is still done.
        </li>
        <li>
          Cycle time runs from its first move into work (in progress or in review) to that finish.
          One created already in work starts when it was created; one reopened starts again from the
          reopen. One that never moved into work, or was filed already done, is counted but not
          timed.
        </li>
        <li>
          Throughput is finishes per seven days, counted back from now, so the last bar is the last
          seven days.
        </li>
        <li>
          Below {minSample} finished issues a project shows its counts and no figures. Changes made
          offline are timed when they reach the server.
        </li>
      </ul>
    </details>
  );
}

function FlowSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Working out the figures"
      className="space-y-2.5"
    >
      {[0, 1].map((n) => (
        <div
          key={n}
          className="h-36 animate-pulse rounded-xl motion-reduce:animate-none border border-line bg-raised"
        />
      ))}
    </div>
  );
}
