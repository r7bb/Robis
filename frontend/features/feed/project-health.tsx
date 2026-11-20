'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { HealthBadge, healthFill } from '../../components/ui/badges.tsx';
import { call } from '../../lib/api.ts';
import { localToday } from '../../lib/due-date.ts';
import { boardHref } from '../../lib/links.ts';
import {
  factsOf,
  type ProjectHealth,
  progressOf,
  projectsKey,
  STATE_LABELS,
} from './project-health-model.ts';

/**
 * How the projects are doing (Phase 2c): a card each, worked out from the
 * issues when the Feed opens and kept live by the board's own events, so
 * the Feed points at the work. Each card opens its board. Nothing shows
 * until there is a project with issues in it.
 */
export function ProjectHealthCards({ workspaceId }: { workspaceId: string }) {
  const projects = useQuery({
    queryKey: projectsKey(workspaceId),
    queryFn: () =>
      call(contracts['feed.projects'], { params: { workspaceId }, query: { today: localToday() } }),
  });
  const list = projects.data?.projects ?? [];
  if (list.length === 0) return null;

  return (
    <section aria-labelledby="project-health-heading" className="mt-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="project-health-heading" className="text-sm font-semibold text-content">
          Projects
        </h2>
        <p className="text-xs text-faint">From their issues, as of now</p>
      </div>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {list.map((project) => (
          <li key={project.id}>
            <HealthCard workspaceId={workspaceId} project={project} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function HealthCard({ workspaceId, project }: { workspaceId: string; project: ProjectHealth }) {
  const progress = progressOf(project);
  const label = STATE_LABELS[project.state];
  const facts = factsOf(project);
  return (
    <Link
      href={boardHref(workspaceId, project.id)}
      aria-label={`${project.name}: ${label}. ${facts.join(', ')}. Open the board.`}
      className="group block rounded-xl border border-line bg-raised p-3.5 transition-[border-color,background-color] duration-200 hover:border-accent-soft/40 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-medium leading-tight text-content">
          <span className="block truncate">{project.name}</span>
          <span className="font-mono text-[11px] font-normal text-faint">{project.key}</span>
        </p>
        <HealthBadge state={project.state} label={label} />
      </div>
      <div className="mt-3 flex items-center gap-2.5">
        <div
          className="h-1 flex-1 overflow-hidden rounded-full bg-surface group-hover:bg-raised"
          aria-hidden="true"
        >
          <div
            className={`h-full rounded-full ${healthFill(project.state)} transition-[width] duration-500 ease-out motion-reduce:transition-none`}
            style={{ width: `${Math.max(progress, 2)}%` }}
          />
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-faint">{progress}% done</span>
      </div>
      <p className="mt-2 text-pretty text-xs leading-relaxed text-muted">{facts.join(' · ')}</p>
    </Link>
  );
}
