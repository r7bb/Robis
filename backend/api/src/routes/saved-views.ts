import {
  type Database,
  labels,
  pgErrorCode,
  recordAudit,
  savedViews,
  workspaceMembers,
} from '@robis/database';
import {
  type BoardFilter,
  boardFilterSchema,
  contracts,
  isUuid,
  SAVED_VIEWS_PER_PROJECT,
} from '@robis/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve, shape } from '../contract.ts';
import { ApiError } from '../errors.ts';
import {
  auditActor,
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';
import { withIdempotency } from '../plugins/idempotency.ts';
import { loadProject } from './projects.ts';

/**
 * Saved views (C1): named board filters. Anyone who can read a project's
 * issues sees its views; members (who shape projects) make and delete them.
 * Each change is audited and goes through the idempotency ledger.
 */

const UNIQUE_VIOLATION = '23505';

const columns = {
  id: savedViews.id,
  projectId: savedViews.projectId,
  name: savedViews.name,
  filter: savedViews.filter,
  createdBy: savedViews.createdBy,
  createdAt: savedViews.createdAt,
};

type Row = { filter: string } & Record<string, unknown>;

/**
 * A stored filter read back. One that no longer parses (from a later schema,
 * say) shows as "everything" rather than failing the whole list.
 */
function readFilter(raw: string): BoardFilter {
  try {
    const parsed = boardFilterSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** A filter as one string, its fields in a fixed order, so two can be compared. */
const canonical = (filter: BoardFilter) =>
  JSON.stringify({
    status: filter.status,
    priority: filter.priority,
    assigneeId: filter.assigneeId,
    labelId: filter.labelId,
  });

const present = <T extends Row>(row: T) => ({ ...row, filter: readFilter(row.filter) });

/**
 * A filter may only name this workspace's labels and people, so a saved
 * view cannot be used to probe ids from elsewhere.
 */
async function assertFilterInWorkspace(db: Database, workspaceId: string, filter: BoardFilter) {
  if (filter.labelId) {
    const [label] = await db
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.id, filter.labelId), eq(labels.workspaceId, workspaceId)));
    if (!label)
      throw ApiError.badRequest('That label is not one of this workspace’s', 'bad_filter');
  }
  if (filter.assigneeId) {
    const [member] = await db
      .select({ id: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, filter.assigneeId),
        ),
      );
    if (!member) throw ApiError.badRequest('That person is not in this workspace', 'bad_filter');
  }
}

export async function savedViewRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  serve(
    app,
    contracts['savedViews.list'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:read')] },
    async (request, { params: { projectId } }) => {
      const { workspaceId } = currentMembership(request);
      await loadProject(db, workspaceId, projectId);
      const rows = await db
        .select(columns)
        .from(savedViews)
        .where(and(eq(savedViews.projectId, projectId), eq(savedViews.workspaceId, workspaceId)))
        .orderBy(asc(savedViews.name));
      return { views: rows.map(present) };
    },
  );

  serve(
    app,
    contracts['savedViews.create'],
    { preHandler: [requireAuth, requireMembership(db, 'project:update')] },
    async (request, { params: { projectId }, body }, reply) => {
      const { workspaceId } = currentMembership(request);
      await loadProject(db, workspaceId, projectId);
      await assertFilterInWorkspace(db, workspaceId, body.filter);
      const actor = auditActor(request);

      return withIdempotency(db, request, reply, 201, async () => {
        try {
          const view = await db.transaction(async (tx) => {
            // One create at a time per project, so two at once cannot both
            // pass the checks below and go over the cap or keep one filter twice.
            await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${projectId}))`);
            const kept = await tx
              .select({ name: savedViews.name, filter: savedViews.filter })
              .from(savedViews)
              .where(eq(savedViews.projectId, projectId));
            if (kept.length >= SAVED_VIEWS_PER_PROJECT) {
              throw ApiError.conflict(
                `A project keeps up to ${SAVED_VIEWS_PER_PROJECT} views; delete one first`,
                'too_many_views',
              );
            }
            const wanted = canonical(body.filter);
            const twin = kept.find((view) => canonical(readFilter(view.filter)) === wanted);
            if (twin) {
              throw ApiError.conflict(`“${twin.name}” shows these issues already`, 'view_exists');
            }
            const [row] = await tx
              .insert(savedViews)
              .values({
                workspaceId,
                projectId,
                name: body.name,
                filter: wanted,
                createdBy: currentUser(request).id,
              })
              .returning(columns);
            await recordAudit(tx, actor, {
              workspaceId,
              entityType: 'saved_view',
              entityId: row!.id,
              eventType: 'saved_view.created',
              payload: { name: row!.name, projectId, filter: body.filter },
            });
            return present(row!);
          });
          return shape(contracts['savedViews.create'], { view });
        } catch (error) {
          if (pgErrorCode(error) === UNIQUE_VIOLATION) {
            throw ApiError.conflict('A view with that name exists already', 'view_exists');
          }
          throw error;
        }
      });
    },
  );

  serve(
    app,
    contracts['savedViews.delete'],
    { preHandler: [requireAuth, requireMembership(db, 'project:update')] },
    async (request, { params: { viewId } }) => {
      const { workspaceId } = currentMembership(request);
      if (!isUuid(viewId)) throw ApiError.notFound('View not found');
      await db.transaction(async (tx) => {
        const [gone] = await tx
          .delete(savedViews)
          .where(and(eq(savedViews.id, viewId), eq(savedViews.workspaceId, workspaceId)))
          .returning({ name: savedViews.name, projectId: savedViews.projectId });
        if (!gone) throw ApiError.notFound('View not found');
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'saved_view',
          entityId: viewId,
          eventType: 'saved_view.deleted',
          payload: { name: gone.name, projectId: gone.projectId },
        });
      });
      return undefined;
    },
  );
}
