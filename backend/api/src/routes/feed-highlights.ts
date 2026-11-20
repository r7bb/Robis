import {
  type Database,
  issues,
  projects,
  users,
  workspaceMembers,
  workspaces,
} from '@robis/database';
import { contracts } from '@robis/shared';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import {
  CELEBRATION_DAYS,
  finishedProjects,
  ISSUE_MILESTONES,
  milestoneCelebrations,
  newestCelebrations,
  peopleCelebrations,
} from '../feed/celebrations.ts';
import {
  byAttention,
  daysBefore,
  healthOf,
  PROJECTS_SHOWN,
  RECENT_DAYS,
  todayFor,
  worthShowing,
} from '../feed/health.ts';
import { currentMembership, requireAuth, requireMembership } from '../plugins/authz.ts';

const isOpen = sql`${issues.status} not in ('DONE', 'CANCELED')`;
const count = (where: ReturnType<typeof sql>) =>
  sql<number>`(count(*) filter (where ${where}))::int`;

/** Each active project's numbers, from its issues, in one pass. */
async function projectStats(db: Database, workspaceId: string, now: Date, today: string) {
  const recent = daysBefore(now, RECENT_DAYS).toISOString();
  return db
    .select({
      id: projects.id,
      key: projects.key,
      name: projects.name,
      open: count(isOpen),
      done: count(sql`${issues.status} = 'DONE'`),
      doneRecently: count(sql`${issues.completedAt} >= ${recent}::timestamptz`),
      openedRecently: count(sql`${issues.createdAt} >= ${recent}::timestamptz`),
      overdue: count(sql`${isOpen} and ${issues.dueOn} < ${today}::date`),
      urgent: count(sql`${isOpen} and ${issues.priority} = 'URGENT'`),
      lastMovedAt: sql<string>`max(${issues.updatedAt})`,
      lastDoneAt: sql<string | null>`max(${issues.completedAt})`,
    })
    .from(projects)
    .innerJoin(
      issues,
      and(eq(issues.projectId, projects.id), eq(issues.workspaceId, projects.workspaceId)),
    )
    .where(and(eq(projects.workspaceId, workspaceId), eq(projects.archived, false)))
    .groupBy(projects.id);
}

/** The people who may be celebrated here: humans who have not turned it off. */
async function celebratable(db: Database, workspaceId: string) {
  return db
    .select({ userId: workspaceMembers.userId, joinedAt: workspaceMembers.createdAt })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.celebrate, true),
        eq(users.kind, 'human'),
      ),
    );
}

/**
 * Each assignee's done issues in the order they were done, keeping only
 * the ones that are a milestone (the 10th, the 25th...) and recent.
 */
async function issueMilestones(db: Database, workspaceId: string, since: Date) {
  const ranked = db
    .select({
      assigneeId: issues.assigneeId,
      completedAt: issues.completedAt,
      n: sql<number>`(row_number() over (partition by ${issues.assigneeId} order by ${issues.completedAt}, ${issues.id}))::int`.as(
        'n',
      ),
    })
    .from(issues)
    .where(
      and(
        eq(issues.workspaceId, workspaceId),
        eq(issues.status, 'DONE'),
        isNotNull(issues.assigneeId),
      ),
    )
    .as('ranked');
  return db
    .select({ userId: ranked.assigneeId, at: ranked.completedAt, n: ranked.n })
    .from(ranked)
    .where(
      and(
        inArray(ranked.n, [...ISSUE_MILESTONES]),
        sql`${ranked.completedAt} >= ${since.toISOString()}::timestamptz`,
      ),
    );
}

/** This week's celebrations for the people who allow them, and finished projects. */
async function celebrationsOf(db: Database, workspaceId: string, now: Date) {
  const since = daysBefore(now, CELEBRATION_DAYS);
  const [people, milestones, projectRows, [workspace]] = await Promise.all([
    celebratable(db, workspaceId),
    issueMilestones(db, workspaceId, since),
    projectStats(db, workspaceId, now, now.toISOString().slice(0, 10)),
    db
      .select({ createdBy: workspaces.createdBy })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId)),
  ]);
  const allowed = new Set(people.map((person) => person.userId));
  return newestCelebrations([
    ...milestoneCelebrations(milestones, allowed),
    ...peopleCelebrations(people, { since, now, creatorId: workspace?.createdBy ?? null }),
    ...finishedProjects(projectRows, since),
  ]);
}

/**
 * Beside the Feed's posts (Phase 2c): how each project is doing, and the
 * week's milestones, worked out from the work on every read, so they are
 * never stale and nothing new is kept about anyone.
 */
export async function feedHighlightRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  serve(
    app,
    contracts['feed.projects'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:read')] },
    async (request, { query }) => {
      const { workspaceId } = currentMembership(request);
      const now = new Date();
      const rows = await projectStats(db, workspaceId, now, todayFor(query.today, now));
      const shown = rows
        .map(({ lastMovedAt, lastDoneAt, ...row }) => {
          const stats = {
            ...row,
            lastMovedAt: new Date(lastMovedAt),
            lastDoneAt: lastDoneAt ? new Date(lastDoneAt) : null,
          };
          return { ...stats, state: healthOf(stats, now), worth: worthShowing(stats, now) };
        })
        .filter((project) => project.worth)
        .sort(byAttention)
        .slice(0, PROJECTS_SHOWN);
      return { projects: shown.map(({ worth: _worth, lastDoneAt: _done, ...project }) => project) };
    },
  );

  serve(
    app,
    contracts['feed.celebrations'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:read')] },
    async (request) => {
      const { workspaceId } = currentMembership(request);
      return { celebrations: await celebrationsOf(db, workspaceId, new Date()) };
    },
  );
}
