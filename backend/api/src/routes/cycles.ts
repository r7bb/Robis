import {
  type AuditActor,
  cycles,
  type Database,
  type Executor,
  issues,
  projects,
  publishEvent,
  recordAudit,
  type Tx,
} from '@robis/database';
import { CYCLE_DAYS_MAX, can, contracts, isUuid } from '@robis/shared';
import { and, asc, eq, notInArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import {
  auditActor,
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';
import { CYCLE_COUNTS, FINISHED } from './cycle-counts.ts';
import { applyIssueUpdate, delegateOf } from './issue-writes.ts';
import { loadProject } from './projects.ts';

const DAY_MS = 86_400_000;

/** A cycle on this board, or not found: another board's is refused like a stranger's. */
export async function assertCycleOn(
  db: Executor,
  workspaceId: string,
  projectId: string,
  cycleId: string,
) {
  const [row] = await db
    .select({ id: cycles.id })
    .from(cycles)
    .where(
      and(
        eq(cycles.id, cycleId),
        eq(cycles.workspaceId, workspaceId),
        eq(cycles.projectId, projectId),
      ),
    );
  if (!row) throw ApiError.badRequest('That cycle is not on this board', 'bad_cycle');
}

/** Days from one calendar day to another, both counted. */
function daysIn(startsOn: string, endsOn: string): number {
  return (
    Math.round((Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`)) / DAY_MS) +
    1
  );
}

function assertSpan(startsOn: string, endsOn: string) {
  if (endsOn < startsOn)
    throw ApiError.badRequest('A cycle ends on or after its start', 'bad_dates');
  if (daysIn(startsOn, endsOn) > CYCLE_DAYS_MAX) {
    throw ApiError.badRequest(`A cycle is at most ${CYCLE_DAYS_MAX} days`, 'too_long');
  }
}

/**
 * Move a cycle's unfinished issues to another of the board's cycles, each
 * recorded as an edit to its cycle. The target is held so it cannot be
 * removed part way, and the issues are locked in id order so two moves at
 * once cannot deadlock. Returns the ids moved.
 */
async function moveUnfinished(
  tx: Tx,
  actor: AuditActor,
  job: {
    workspaceId: string;
    projectId: string;
    fromId: string;
    fromEndsOn: string;
    toId: string;
    delegateId: string | null;
  },
): Promise<string[]> {
  const [target] = await tx
    .select({ id: cycles.id, endsOn: cycles.endsOn })
    .from(cycles)
    .where(
      and(
        eq(cycles.id, job.toId),
        eq(cycles.workspaceId, job.workspaceId),
        eq(cycles.projectId, job.projectId),
      ),
    )
    .for('share');
  if (!target) throw ApiError.badRequest('That cycle is not on this board', 'bad_cycle');
  // Work left over goes on, never back into a cycle that is over sooner.
  if (target.endsOn < job.fromEndsOn) {
    throw ApiError.badRequest('Move them to a cycle that ends later', 'earlier_cycle');
  }

  const rows = await tx
    .select({ issue: issues, projectKey: projects.key })
    .from(issues)
    .innerJoin(projects, eq(projects.id, issues.projectId))
    .where(
      and(
        eq(issues.workspaceId, job.workspaceId),
        eq(issues.cycleId, job.fromId),
        notInArray(issues.status, [...FINISHED]),
      ),
    )
    .orderBy(asc(issues.id))
    .for('update', { of: issues });
  for (const { issue, projectKey } of rows) {
    await applyIssueUpdate(tx, actor, {
      workspaceId: job.workspaceId,
      issueId: issue.id,
      input: { cycleId: job.toId },
      delegateId: job.delegateId,
      issueKey: `${projectKey}-${issue.number}`,
      title: issue.title,
      previous: issue,
    });
  }
  return rows.map((row) => row.issue.id);
}

/**
 * Cycles: stretches of days a board plans work for. Members plan them;
 * each lists how its issues stand. Removing one leaves its issues on the
 * board, unplanned.
 */
export async function cycleRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  async function withCounts(projectId: string, cycleId?: string) {
    const rows = await db
      .select(CYCLE_COUNTS)
      .from(cycles)
      .leftJoin(issues, eq(issues.cycleId, cycles.id))
      .where(and(eq(cycles.projectId, projectId), cycleId ? eq(cycles.id, cycleId) : undefined))
      .groupBy(cycles.id)
      .orderBy(asc(cycles.startsOn));
    return rows;
  }

  async function cycleIn(request: FastifyRequest, cycleId: string) {
    const { workspaceId } = currentMembership(request);
    if (!isUuid(cycleId)) throw ApiError.notFound('Cycle not found');
    const [row] = await db
      .select()
      .from(cycles)
      .where(and(eq(cycles.id, cycleId), eq(cycles.workspaceId, workspaceId)));
    if (!row) throw ApiError.notFound('Cycle not found');
    return row;
  }

  serve(
    app,
    contracts['cycles.list'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:read')] },
    async (request, { params: { projectId } }) => {
      const project = await loadProject(db, currentMembership(request).workspaceId, projectId);
      return { cycles: await withCounts(project.id) };
    },
  );

  serve(
    app,
    contracts['cycles.create'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:update')] },
    async (request, { params: { projectId }, body }) => {
      const { workspaceId } = currentMembership(request);
      const project = await loadProject(db, workspaceId, projectId);
      assertSpan(body.startsOn, body.endsOn);
      const made = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(cycles)
          .values({
            workspaceId,
            projectId: project.id,
            name: body.name,
            startsOn: body.startsOn,
            endsOn: body.endsOn,
            createdBy: currentUser(request).id,
          })
          .returning();
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'project',
          entityId: project.id,
          eventType: 'cycle.created',
          payload: { cycleId: row!.id, name: row!.name },
        });
        return row!;
      });
      const [cycle] = await withCounts(project.id, made.id);
      return { cycle: cycle! };
    },
  );

  serve(
    app,
    contracts['cycles.update'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:update')] },
    async (request, { params: { cycleId }, body }) => {
      const row = await cycleIn(request, cycleId);
      const startsOn = body.startsOn ?? row.startsOn;
      const endsOn = body.endsOn ?? row.endsOn;
      assertSpan(startsOn, endsOn);
      await db
        .update(cycles)
        .set({ name: body.name ?? row.name, startsOn, endsOn })
        .where(eq(cycles.id, row.id));
      const [cycle] = await withCounts(row.projectId, row.id);
      return { cycle: cycle! };
    },
  );

  serve(
    app,
    contracts['cycles.rollover'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:update')] },
    async (request, { params: { cycleId }, body }) => {
      const { workspaceId } = currentMembership(request);
      const user = currentUser(request);
      const from = await cycleIn(request, cycleId);
      const toId = body.toCycleId.toLowerCase();
      if (toId === from.id) {
        throw ApiError.badRequest('Choose another cycle to move them to', 'same_cycle');
      }
      const moved = await db.transaction((tx) =>
        moveUnfinished(tx, auditActor(request), {
          workspaceId,
          projectId: from.projectId,
          fromId: from.id,
          fromEndsOn: from.endsOn,
          toId,
          delegateId: delegateOf(user),
        }),
      );
      for (const issueId of moved) {
        await publishEvent(db, {
          type: 'issue.updated',
          workspaceId,
          projectId: from.projectId,
          issueId,
          actorId: user.id,
        });
      }
      const [cycle] = await withCounts(from.projectId, toId);
      return { moved: moved.length, cycle: cycle! };
    },
  );

  serve(
    app,
    contracts['cycles.remove'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:update')] },
    async (request, { params: { cycleId } }) => {
      const { workspaceId, role } = currentMembership(request);
      const row = await cycleIn(request, cycleId);
      if (row.createdBy !== currentUser(request).id && !can(role, 'project:update')) {
        throw ApiError.forbidden();
      }
      await db.transaction(async (tx) => {
        // Its issues stay on the board, unplanned (the reference clears).
        await tx.delete(cycles).where(eq(cycles.id, row.id));
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'project',
          entityId: row.projectId,
          eventType: 'cycle.removed',
          payload: { cycleId: row.id, name: row.name },
        });
      });
      return undefined;
    },
  );
}
