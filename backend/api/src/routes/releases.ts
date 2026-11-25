import { type Database, type Executor, issues, projects, releases } from '@robis/database';
import { can, canonicalZone, contracts, isUuid, releaseNotes } from '@robis/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import {
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';

// Which releases an issue may move between is checked where every issue
// edit goes: `assertReleaseMove` in issue-writes.ts.

const COUNTS = {
  id: releases.id,
  name: releases.name,
  targetOn: releases.targetOn,
  shippedAt: releases.shippedAt,
  notes: releases.notes,
  createdBy: releases.createdBy,
  total: sql<number>`count(${issues.id})::int`,
  done: sql<number>`(count(${issues.id}) filter (where ${issues.status} = 'DONE'))::int`,
  canceled: sql<number>`(count(${issues.id}) filter (where ${issues.status} = 'CANCELED'))::int`,
};

/** Releases: planned, given issues from any board, shipped with notes. */
export async function releaseRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  async function withCounts(workspaceId: string, releaseId?: string) {
    return db
      .select(COUNTS)
      .from(releases)
      .leftJoin(issues, eq(issues.releaseId, releases.id))
      .where(
        and(
          eq(releases.workspaceId, workspaceId),
          releaseId ? eq(releases.id, releaseId) : undefined,
        ),
      )
      .groupBy(releases.id)
      .orderBy(
        // Still to ship first, by the day aimed at (none last); then shipped, latest first.
        sql`${releases.shippedAt} is not null`,
        asc(releases.targetOn),
        desc(releases.shippedAt),
        asc(releases.createdAt),
      );
  }

  async function releaseIn(request: FastifyRequest, releaseId: string) {
    const { workspaceId } = currentMembership(request);
    if (!isUuid(releaseId)) throw ApiError.notFound('Release not found');
    const [row] = await withCounts(workspaceId, releaseId);
    if (!row) throw ApiError.notFound('Release not found');
    return row;
  }

  async function issuesOf(on: Executor, workspaceId: string, releaseId: string) {
    const rows = await on
      .select({
        id: issues.id,
        number: issues.number,
        title: issues.title,
        status: issues.status,
        projectId: projects.id,
        projectName: projects.name,
        projectKey: projects.key,
      })
      .from(issues)
      .innerJoin(projects, eq(projects.id, issues.projectId))
      .where(and(eq(issues.workspaceId, workspaceId), eq(issues.releaseId, releaseId)))
      .orderBy(asc(projects.name), asc(issues.number));
    return rows.map(({ number, projectKey, ...row }) => ({
      ...row,
      key: `${projectKey}-${number}`,
    }));
  }

  serve(
    app,
    contracts['releases.list'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:read')] },
    async (request) => ({ releases: await withCounts(currentMembership(request).workspaceId) }),
  );

  serve(
    app,
    contracts['releases.create'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:update')] },
    async (request, { body }) => {
      const { workspaceId } = currentMembership(request);
      const [made] = await db
        .insert(releases)
        .values({
          workspaceId,
          name: body.name,
          targetOn: body.targetOn ?? null,
          timeZone: canonicalZone(body.timeZone ?? 'UTC') ?? 'UTC',
          createdBy: currentUser(request).id,
        })
        .returning({ id: releases.id });
      const [release] = await withCounts(workspaceId, made!.id);
      return { release: release! };
    },
  );

  serve(
    app,
    contracts['releases.get'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:read')] },
    async (request, { params: { releaseId } }) => {
      const release = await releaseIn(request, releaseId);
      return {
        release,
        issues: await issuesOf(db, currentMembership(request).workspaceId, release.id),
      };
    },
  );

  serve(
    app,
    contracts['releases.update'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:update')] },
    async (request, { params: { releaseId }, body }) => {
      const { workspaceId } = currentMembership(request);
      const release = await releaseIn(request, releaseId);
      // Only while still to ship: what shipped keeps the name and day its notes give.
      const [changed] = await db
        .update(releases)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.targetOn !== undefined ? { targetOn: body.targetOn } : {}),
        })
        .where(and(eq(releases.id, release.id), sql`${releases.shippedAt} is null`))
        .returning({ id: releases.id });
      if (!changed) {
        throw ApiError.badRequest(
          'That release has shipped; it keeps its name and day',
          'release_shipped',
        );
      }
      const [after] = await withCounts(workspaceId, release.id);
      return { release: after! };
    },
  );

  serve(
    app,
    contracts['releases.ship'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:update')] },
    async (request, { params: { releaseId } }) => {
      const { workspaceId } = currentMembership(request);
      const release = await releaseIn(request, releaseId);
      if (release.shippedAt) {
        throw ApiError.badRequest('That release has already shipped', 'release_shipped');
      }
      await db.transaction(async (tx) => {
        // Held first: an issue moving in or out waits, so the notes are what
        // was in it; and two ships at once ship it once.
        const [held] = await tx
          .select({ shippedAt: releases.shippedAt })
          .from(releases)
          .where(eq(releases.id, release.id))
          .for('update');
        if (!held || held.shippedAt) {
          throw ApiError.badRequest('That release has already shipped', 'release_shipped');
        }
        const now = new Date();
        const notes = releaseNotes({
          name: release.name,
          shippedOn: now.toISOString().slice(0, 10),
          issues: await issuesOf(tx, workspaceId, release.id),
        });
        await tx.update(releases).set({ shippedAt: now, notes }).where(eq(releases.id, release.id));
      });
      const [after] = await withCounts(workspaceId, release.id);
      return { release: after! };
    },
  );

  serve(
    app,
    contracts['releases.remove'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:update')] },
    async (request, { params: { releaseId } }) => {
      const { role } = currentMembership(request);
      const release = await releaseIn(request, releaseId);
      if (release.createdBy !== currentUser(request).id && !can(role, 'project:delete')) {
        throw ApiError.forbidden();
      }
      // Its issues stay where they are, in no release (the reference clears).
      await db.delete(releases).where(eq(releases.id, release.id));
      return undefined;
    },
  );
}
