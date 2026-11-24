import {
  celebrationReactions,
  type Database,
  issues,
  projects,
  publishEvent,
  users,
  workspaceMembers,
  workspaces,
} from '@robis/database';
import { contracts, noReactions, type PostReaction } from '@robis/shared';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
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
import {
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';

/** Reactions to celebrations a person may give or take back in an hour, as on posts. */
const REACTIONS_PER_HOUR = 300;
const HOUR_MS = 3_600_000;
/** How long the list of live celebration ids is kept per workspace. */
const LIVE_IDS_MS = 10_000;
/** Workspaces kept at once before the cache starts again. */
const LIVE_IDS_KEPT = 500;

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

/** Who reacted how to each of these celebrations, in one query. */
async function withReactions<T extends { id: string }>(
  db: Database,
  workspaceId: string,
  shown: T[],
) {
  const byId = new Map(shown.map((c) => [c.id, noReactions()]));
  if (shown.length > 0) {
    const rows = await db
      .select({
        celebrationId: celebrationReactions.celebrationId,
        userId: celebrationReactions.userId,
        reaction: celebrationReactions.reaction,
      })
      .from(celebrationReactions)
      // Only people still here: someone who left is not shown reacting.
      .innerJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, celebrationReactions.workspaceId),
          eq(workspaceMembers.userId, celebrationReactions.userId),
        ),
      )
      .where(
        and(
          eq(celebrationReactions.workspaceId, workspaceId),
          inArray(celebrationReactions.celebrationId, [...byId.keys()]),
        ),
      )
      .orderBy(celebrationReactions.createdAt);
    for (const row of rows) byId.get(row.celebrationId)?.[row.reaction].push(row.userId);
  }
  return shown.map((c) => ({ ...c, reactions: byId.get(c.id)! }));
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
      const shown = await celebrationsOf(db, workspaceId, new Date());
      return { celebrations: await withReactions(db, workspaceId, shown) };
    },
  );

  const reactLimit = rateLimit({
    name: 'celebration-react',
    limit: REACTIONS_PER_HOUR,
    windowMs: HOUR_MS,
  });

  /**
   * The ids on the list right now, kept a few seconds per workspace: working
   * them out reads every project, so a burst of reactions reads them once.
   */
  const liveIds = new Map<string, { at: number; ids: Set<string> }>();
  async function liveCelebrations(workspaceId: string) {
    const kept = liveIds.get(workspaceId);
    if (kept && Date.now() - kept.at < LIVE_IDS_MS) return kept.ids;
    const ids = new Set((await celebrationsOf(db, workspaceId, new Date())).map((c) => c.id));
    if (liveIds.size > LIVE_IDS_KEPT) liveIds.clear();
    liveIds.set(workspaceId, { at: Date.now(), ids });
    return ids;
  }

  /**
   * Only a celebration on the list right now takes a reaction: its id is
   * worked out, so anything else is a name nobody is celebrating. Taking one
   * back needs no such check, so a reaction can be undone after its week.
   */
  async function celebrationHere(workspaceId: string, celebrationId: string) {
    if (!(await liveCelebrations(workspaceId)).has(celebrationId)) {
      throw ApiError.notFound('Celebration not found');
    }
  }

  async function toggle(
    request: Parameters<typeof currentUser>[0],
    celebrationId: string,
    reaction: PostReaction,
    on: boolean,
  ) {
    const { workspaceId } = currentMembership(request);
    const user = currentUser(request);
    if (on) await celebrationHere(workspaceId, celebrationId);
    const key = { workspaceId, celebrationId, userId: user.id, reaction };
    const changed = on
      ? await db
          .insert(celebrationReactions)
          .values(key)
          .onConflictDoNothing()
          .returning({ id: celebrationReactions.celebrationId })
      : await db
          .delete(celebrationReactions)
          .where(
            and(
              eq(celebrationReactions.workspaceId, workspaceId),
              eq(celebrationReactions.celebrationId, celebrationId),
              eq(celebrationReactions.userId, user.id),
              eq(celebrationReactions.reaction, reaction),
            ),
          )
          .returning({ id: celebrationReactions.celebrationId });
    if (changed.length === 0) return;
    try {
      await publishEvent(db, {
        type: 'celebration.changed',
        workspaceId,
        celebrationId,
        actorId: user.id,
      });
    } catch (error) {
      request.log.warn({ err: error }, 'feed: celebration reaction not published');
    }
  }

  serve(
    app,
    contracts['feed.reactToCelebration'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:read'), reactLimit] },
    async (request, { params: { celebrationId, reaction } }) => {
      await toggle(request, celebrationId, reaction, true);
      return undefined;
    },
  );

  serve(
    app,
    contracts['feed.unreactToCelebration'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:read'), reactLimit] },
    async (request, { params: { celebrationId, reaction } }) => {
      await toggle(request, celebrationId, reaction, false);
      return undefined;
    },
  );
}
