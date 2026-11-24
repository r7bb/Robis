import { type Database, projects, projectUpdates, recordAudit, users } from '@robis/database';
import { can, contracts, isUuid, PROJECT_UPDATE_FRESH_DAYS } from '@robis/shared';
import { and, desc, eq, gte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import {
  auditActor,
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';
import { loadProject } from './projects.ts';

/** The latest a board's list shows. */
const UPDATES_SHOWN = 20;
const UPDATES_PER_HOUR = 20;
const DAY_MS = 86_400_000;

const columns = {
  id: projectUpdates.id,
  projectId: projectUpdates.projectId,
  health: projectUpdates.health,
  body: projectUpdates.body,
  authorId: projectUpdates.authorId,
  authorName: users.name,
  createdAt: projectUpdates.createdAt,
};

/**
 * Project updates: written by members, read by everyone who may read the
 * board, taken down by their author or an admin. Each is in the audit log
 * by length, not by what it says.
 */
export async function projectUpdateRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;
  const writeLimit = rateLimit({
    name: 'project-updates',
    limit: UPDATES_PER_HOUR,
    windowMs: 3_600_000,
  });

  serve(
    app,
    contracts['projectUpdates.list'],
    { preHandler: [requireAuth, requireMembership(db, 'project:read')] },
    async (request, { params: { projectId } }) => {
      const project = await loadProject(db, currentMembership(request).workspaceId, projectId);
      const updates = await db
        .select(columns)
        .from(projectUpdates)
        .innerJoin(users, eq(users.id, projectUpdates.authorId))
        .where(eq(projectUpdates.projectId, project.id))
        .orderBy(desc(projectUpdates.createdAt))
        .limit(UPDATES_SHOWN);
      return { updates };
    },
  );

  serve(
    app,
    contracts['projectUpdates.latest'],
    { preHandler: [requireAuth, requireMembership(db, 'project:read')] },
    async (request) => {
      const { workspaceId } = currentMembership(request);
      const since = new Date(Date.now() - PROJECT_UPDATE_FRESH_DAYS * DAY_MS);
      const updates = await db
        .selectDistinctOn([projectUpdates.projectId], columns)
        .from(projectUpdates)
        .innerJoin(users, eq(users.id, projectUpdates.authorId))
        .innerJoin(projects, eq(projects.id, projectUpdates.projectId))
        .where(
          and(
            eq(projectUpdates.workspaceId, workspaceId),
            eq(projects.archived, false),
            gte(projectUpdates.createdAt, since),
          ),
        )
        .orderBy(projectUpdates.projectId, desc(projectUpdates.createdAt));
      return { updates };
    },
  );

  serve(
    app,
    contracts['projectUpdates.create'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:update'), writeLimit] },
    async (request, { params: { projectId }, body }) => {
      const { workspaceId } = currentMembership(request);
      const project = await loadProject(db, workspaceId, projectId);
      const me = currentUser(request);
      const made = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(projectUpdates)
          .values({ workspaceId, projectId: project.id, authorId: me.id, ...body })
          .returning();
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'project',
          entityId: project.id,
          eventType: 'project.update_posted',
          payload: { health: body.health, length: body.body.length },
        });
        return row!;
      });
      return { update: { ...made, authorName: me.name } };
    },
  );

  serve(
    app,
    contracts['projectUpdates.remove'],
    { preHandler: [requireAuth, requireMembership(db, 'project:read')] },
    async (request, { params: { updateId } }) => {
      const { workspaceId, role } = currentMembership(request);
      if (!isUuid(updateId)) throw ApiError.notFound('Update not found');
      const [row] = await db
        .select({
          id: projectUpdates.id,
          authorId: projectUpdates.authorId,
          projectId: projectUpdates.projectId,
        })
        .from(projectUpdates)
        .where(and(eq(projectUpdates.id, updateId), eq(projectUpdates.workspaceId, workspaceId)));
      if (!row) throw ApiError.notFound('Update not found');
      if (row.authorId !== currentUser(request).id && !can(role, 'project:delete')) {
        throw ApiError.forbidden('Only its author, or an admin, takes an update down');
      }
      await db.transaction(async (tx) => {
        await tx.delete(projectUpdates).where(eq(projectUpdates.id, row.id));
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'project',
          entityId: row.projectId,
          eventType: 'project.update_removed',
          payload: { updateId: row.id },
        });
      });
      return undefined;
    },
  );
}
