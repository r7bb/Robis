import type { CelebrationKind } from '@robis/shared';

/**
 * Celebrations (Phase 2c): milestones from the work, worked out on every
 * read by rules written down here. Nothing is stored about anyone, and
 * whoever turned celebrations off is simply never in the list.
 */

/** How far back a milestone still counts as news. */
export const CELEBRATION_DAYS = 7;
/** The issue counts worth a well done. */
export const ISSUE_MILESTONES: readonly number[] = [10, 25, 50, 100, 250, 500, 1000];
/** A finished project needs this many done issues to be worth one. */
export const FINISHED_MIN_DONE = 3;
/**
 * Celebrations sent at once, newest first: more than the Feed shows (five),
 * so putting some away brings on the next.
 */
export const CELEBRATIONS_SENT = 12;

export type Celebration = {
  id: string;
  kind: CelebrationKind;
  at: Date;
  userId: string | null;
  projectId: string | null;
  projectName: string | null;
  count: number | null;
  /** The cycle cleared, for that kind. */
  cycleName?: string | null;
};

/**
 * The anniversary of joining that falls in (since, now], with how many
 * years it marks, or null. A first day is a welcome, not an anniversary.
 * Joined on 29 February, the day is 1 March in other years.
 */
export function anniversaryIn(
  joinedAt: Date,
  since: Date,
  now: Date,
): { years: number; at: Date } | null {
  for (const year of [now.getUTCFullYear(), now.getUTCFullYear() - 1]) {
    const years = year - joinedAt.getUTCFullYear();
    if (years < 1) continue;
    const at = new Date(joinedAt);
    at.setUTCFullYear(year);
    if (at > since && at <= now) return { years, at };
  }
  return null;
}

/** The deterministic id: the same milestone keeps the same name. */
export function celebrationId(
  kind: CelebrationKind,
  subject: string,
  count: number | null = null,
): string {
  return count === null ? `${kind}:${subject}` : `${kind}:${subject}:${count}`;
}

/** Newest first, then a stable order, and only so many. */
export function newestCelebrations(list: Celebration[]): Celebration[] {
  return [...list]
    .sort((a, b) => b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id))
    .slice(0, CELEBRATIONS_SENT);
}

const none = { projectId: null, projectName: null };

/** Someone's 10th (25th...) issue done, for those who allow it. */
export function milestoneCelebrations(
  rows: readonly { userId: string | null; at: Date | string | null; n: number }[],
  allowed: ReadonlySet<string>,
): Celebration[] {
  return rows.flatMap(({ userId, at, n }) =>
    userId && at && allowed.has(userId)
      ? [
          {
            ...none,
            id: celebrationId('issues_done', userId, n),
            kind: 'issues_done' as const,
            at: new Date(at),
            userId,
            count: n,
          },
        ]
      : [],
  );
}

/**
 * Welcomes and anniversaries, for the people passed in (those who allow
 * them). Whoever made the workspace did not join it, so is not welcomed.
 */
export function peopleCelebrations(
  people: readonly { userId: string; joinedAt: Date }[],
  { since, now, creatorId }: { since: Date; now: Date; creatorId: string | null },
): Celebration[] {
  return people.flatMap(({ userId, joinedAt }) => {
    const found: Celebration[] = [];
    if (joinedAt > since && joinedAt <= now && userId !== creatorId) {
      found.push({
        ...none,
        id: celebrationId('joined', userId),
        kind: 'joined',
        at: joinedAt,
        userId,
        count: null,
      });
    }
    const anniversary = anniversaryIn(joinedAt, since, now);
    if (anniversary) {
      found.push({
        ...none,
        id: celebrationId('anniversary', userId, anniversary.years),
        kind: 'anniversary',
        at: anniversary.at,
        userId,
        count: anniversary.years,
      });
    }
    return found;
  });
}

/** A project with every issue closed, enough of them done, the last one recently. */
export function finishedProjects(
  rows: readonly {
    id: string;
    name: string;
    open: number;
    done: number;
    lastDoneAt: Date | string | null;
  }[],
  since: Date,
): Celebration[] {
  return rows.flatMap((project) => {
    const lastDone = project.lastDoneAt ? new Date(project.lastDoneAt) : null;
    if (project.open > 0 || project.done < FINISHED_MIN_DONE || !lastDone || lastDone < since) {
      return [];
    }
    return [
      {
        id: celebrationId('project_finished', project.id),
        kind: 'project_finished' as const,
        at: lastDone,
        userId: null,
        projectId: project.id,
        projectName: project.name,
        count: project.done,
      },
    ];
  });
}

/**
 * A cycle whose last day ended this week with every planned issue done by
 * then (canceled ones left out), none moved on or taken out unfinished, and
 * enough of them to be worth one.
 */
export function clearedCycles(
  rows: readonly {
    id: string;
    name: string;
    projectId: string;
    projectName: string;
    counted: number;
    done: number;
    leftUnfinished: number;
    endedAt: Date | string;
  }[],
  since: Date,
): Celebration[] {
  return rows.flatMap((cycle) => {
    const endedAt = new Date(cycle.endedAt);
    const cleared = cycle.done >= cycle.counted && cycle.leftUnfinished === 0;
    if (!cleared || cycle.counted < FINISHED_MIN_DONE || endedAt < since) return [];
    return [
      {
        id: celebrationId('cycle_cleared', cycle.id),
        kind: 'cycle_cleared' as const,
        at: endedAt,
        userId: null,
        projectId: cycle.projectId,
        projectName: cycle.projectName,
        count: cycle.done,
        cycleName: cycle.name,
      },
    ];
  });
}
