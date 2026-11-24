import { cycles, type Database, type Executor, issues, recordAudit } from '@robis/database';
import { CYCLE_DAYS_MAX, can, contracts, isUuid } from '@robis/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
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
 * Cycles: stretches of days a board plans work for. Members plan them;
 * each lists how its issues stand. Removing one leaves its issues on the
 * board, unplanned.
 */
export async function cycleRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  async function withCounts(projectId: string, cycleId?: string) {
    const rows = await db
      .select({
        id: cycles.id,
        projectId: cycles.projectId,
        name: cycles.name,
        startsOn: cycles.startsOn,
        endsOn: cycles.endsOn,
        total: sql<number>`count(${issues.id})::int`,
        done: sql<number>`(count(${issues.id}) filter (where ${issues.status} = 'DONE'))::int`,
        canceled: sql<number>`(count(${issues.id}) filter (where ${issues.status} = 'CANCELED'))::int`,
        inProgress: sql<number>`(count(${issues.id}) filter (where ${issues.status} in ('IN_PROGRESS', 'IN_REVIEW')))::int`,
      })
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
