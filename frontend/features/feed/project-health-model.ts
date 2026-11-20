import type { contracts, ProjectHealthState, ResponseOf } from '@robis/shared';

/**
 * Project health as the Feed words it (Phase 2c): pure, so what each card
 * says is tested without a browser. Every state is said in words beside
 * the numbers that led to it, never by colour alone.
 */

export type ProjectHealth = ResponseOf<(typeof contracts)['feed.projects']>['projects'][number];

export const projectsKey = (workspaceId: string) => ['feed-projects', workspaceId] as const;

export const STATE_LABELS: Record<ProjectHealthState, string> = {
  needs_a_look: 'Needs a look',
  on_track: 'On track',
  quiet: 'Quiet',
  finished: 'Finished',
};

const DAY_MS = 86_400_000;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Done out of what is not cancelled, as a whole percentage. */
export function progressOf(project: Pick<ProjectHealth, 'open' | 'done'>): number {
  const total = project.open + project.done;
  return total === 0 ? 0 : Math.round((project.done / total) * 100);
}

/** The facts behind the state, most pressing first, at most three. */
export function factsOf(project: ProjectHealth, now = Date.now()): string[] {
  const facts: string[] = [];
  if (project.overdue > 0) facts.push(`${project.overdue} overdue`);
  if (project.urgent > 0) facts.push(`${project.urgent} urgent`);
  if (project.state === 'quiet') {
    const days = Math.floor((now - new Date(project.lastMovedAt).getTime()) / DAY_MS);
    facts.push(`nothing moved in ${plural(days, 'day')}`);
  }
  if (project.doneRecently > 0) facts.push(`${project.doneRecently} done this week`);
  if (project.state !== 'finished') facts.push(`${project.open} open`);
  if (project.state === 'finished') facts.push(`all ${plural(project.done, 'issue')} done`);
  return facts.slice(0, 3);
}
