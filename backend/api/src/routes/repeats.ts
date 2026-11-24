import { type Database, recordAudit, recurringIssues, users } from '@robis/database';
import {
  can,
  contracts,
  isUuid,
  nextRunAfter,
  REPEATS_PER_PROJECT,
  type RepeatCadence,
} from '@robis/shared';
import { and, asc, count, eq } from 'drizzle-orm';
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
import { assertAssignable } from './issue-writes.ts';
import { loadProject } from './projects.ts';

type Row = typeof recurringIssues.$inferSelect;

/** A repeat as the API shows it. */
function wire(row: Row, createdByName: string) {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    priority: row.priority,
    assigneeId: row.assigneeId,
    cadence: row.cadence as RepeatCadence,
    weekday: row.weekday,
    monthDay: row.monthDay,
    hour: row.hour,
    timeZone: row.timeZone,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    paused: row.paused,
    createdBy: row.createdBy,
    createdByName,
  };
}

/** Only the fields a cadence uses are kept: a daily repeat has no day. */
function scheduleOf(input: {
  cadence: RepeatCadence;
  weekday: number | null;
  monthDay: number | null;
  hour: number;
  timeZone: string;
}) {
  return {
    cadence: input.cadence,
    weekday: input.cadence === 'weekly' ? input.weekday : null,
    monthDay: input.cadence === 'monthly' ? input.monthDay : null,
    hour: input.hour,
    timeZone: input.timeZone,
  };
}

type Changes = {
  title?: string;
  description?: string | null;
  priority?: Row['priority'];
  assigneeId?: string | null;
  paused?: boolean;
  cadence?: RepeatCadence;
  weekday?: number | null;
  monthDay?: number | null;
  hour?: number;
  timeZone?: string;
};

/** The schedule after a change: what changed, the rest as it was; refused when it does not hold. */
function scheduleAfter(body: Changes, row: Row) {
  const schedule = scheduleOf({
    cadence: body.cadence ?? (row.cadence as RepeatCadence),
    weekday: body.weekday !== undefined ? body.weekday : row.weekday,
    monthDay: body.monthDay !== undefined ? body.monthDay : row.monthDay,
    hour: body.hour ?? row.hour,
    timeZone: body.timeZone ?? row.timeZone,
  });
  if (schedule.cadence === 'weekly' && schedule.weekday === null) {
    throw ApiError.badRequest('A weekly repeat needs its day', 'no_day');
  }
  if (schedule.cadence === 'monthly' && schedule.monthDay === null) {
    throw ApiError.badRequest('A monthly repeat needs its date', 'no_date');
  }
  return schedule;
}

/** The settings a change names, and only those. */
function changedSettings(body: Changes) {
  const keys = ['title', 'description', 'priority', 'assigneeId', 'paused'] as const;
  return Object.fromEntries(
    keys.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]),
  );
}

/**
 * Repeats: issues filed on a board on a schedule. Whoever may file issues
 * sets one up; its creator, or an admin, changes,
 * pauses or removes it. The API's runner files them (see repeats/run.ts).
 */
export async function repeatRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  async function withName(row: Row) {
    const [creator] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, row.createdBy));
    return wire(row, creator?.name ?? 'Someone');
  }

  /** A repeat here that this person may change; not found or refused otherwise. */
  async function mine(request: FastifyRequest, repeatId: string) {
    const { workspaceId, role } = currentMembership(request);
    if (!isUuid(repeatId)) throw ApiError.notFound('Repeat not found');
    const [row] = await db
      .select()
      .from(recurringIssues)
      .where(and(eq(recurringIssues.id, repeatId), eq(recurringIssues.workspaceId, workspaceId)));
    if (!row) throw ApiError.notFound('Repeat not found');
    if (row.createdBy !== currentUser(request).id && !can(role, 'project:delete')) {
      throw ApiError.forbidden('Only whoever set it up, or an admin, changes a repeat');
    }
    return row;
  }

  serve(
    app,
    contracts['repeats.list'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:read')] },
    async (request, { params: { projectId } }) => {
      const { workspaceId } = currentMembership(request);
      const project = await loadProject(db, workspaceId, projectId);
      const rows = await db
        .select({ row: recurringIssues, name: users.name })
        .from(recurringIssues)
        .innerJoin(users, eq(users.id, recurringIssues.createdBy))
        .where(eq(recurringIssues.projectId, project.id))
        .orderBy(asc(recurringIssues.paused), asc(recurringIssues.nextRunAt));
      return { repeats: rows.map(({ row, name }) => wire(row, name)) };
    },
  );

  serve(
    app,
    contracts['repeats.create'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:create')] },
    async (request, { params: { projectId }, body }) => {
      const { workspaceId } = currentMembership(request);
      const project = await loadProject(db, workspaceId, projectId);
      if (body.assigneeId) await assertAssignable(db, workspaceId, body.assigneeId);
      const [{ n } = { n: 0 }] = await db
        .select({ n: count() })
        .from(recurringIssues)
        .where(eq(recurringIssues.projectId, project.id));
      if (n >= REPEATS_PER_PROJECT) {
        throw ApiError.conflict(`A board has at most ${REPEATS_PER_PROJECT} repeats`, 'too_many');
      }
      const schedule = scheduleOf(body);
      const row = await db.transaction(async (tx) => {
        const [made] = await tx
          .insert(recurringIssues)
          .values({
            workspaceId,
            projectId: project.id,
            title: body.title,
            description: body.description,
            priority: body.priority,
            assigneeId: body.assigneeId,
            ...schedule,
            nextRunAt: nextRunAfter(schedule, new Date()),
            createdBy: currentUser(request).id,
          })
          .returning();
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'project',
          entityId: project.id,
          eventType: 'repeat.created',
          payload: { repeatId: made!.id, title: made!.title, cadence: made!.cadence },
        });
        return made!;
      });
      return { repeat: await withName(row) };
    },
  );

  serve(
    app,
    contracts['repeats.update'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:create')] },
    async (request, { params: { repeatId }, body }) => {
      const { workspaceId } = currentMembership(request);
      const row = await mine(request, repeatId);
      if (body.assigneeId) await assertAssignable(db, workspaceId, body.assigneeId);
      const schedule = scheduleAfter(body, row);
      const [updated] = await db
        .update(recurringIssues)
        .set({
          ...changedSettings(body),
          ...schedule,
          // Worked out again from now: a repeat resumed after a month is not
          // a month of issues at once.
          nextRunAt: nextRunAfter(schedule, new Date()),
        })
        .where(eq(recurringIssues.id, row.id))
        .returning();
      return { repeat: await withName(updated!) };
    },
  );

  serve(
    app,
    contracts['repeats.remove'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:create')] },
    async (request, { params: { repeatId } }) => {
      const { workspaceId } = currentMembership(request);
      const row = await mine(request, repeatId);
      await db.transaction(async (tx) => {
        await tx.delete(recurringIssues).where(eq(recurringIssues.id, row.id));
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'project',
          entityId: row.projectId,
          eventType: 'repeat.removed',
          payload: { repeatId: row.id, title: row.title },
        });
      });
      return undefined;
    },
  );
}
