import {
  type Database,
  issueBlocks,
  issues,
  projects,
  publishEvent,
  recordAudit,
} from '@robis/database';
import { BLOCKERS_MAX, contracts, isUuid } from '@robis/shared';
import { and, count, eq, sql } from 'drizzle-orm';
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

/** How far a loop is looked for: further than any real chain of waiting. */
const LOOP_SEARCH_DEPTH = 50;

/**
 * Blocked by: one issue waiting on another. Both must be in the workspace,
 * an issue never waits on itself, and a link that would close a loop (A
 * waits on B, which waits on A, however far round) is refused, so "what is
 * it waiting on" always has an answer.
 */
export async function issueBlockRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  async function issueIn(workspaceId: string, issueId: string) {
    if (!isUuid(issueId)) throw ApiError.notFound('Issue not found');
    const [row] = await db
      .select({ id: issues.id, projectId: issues.projectId })
      .from(issues)
      .where(and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)));
    if (!row) throw ApiError.notFound('Issue not found');
    return row;
  }

  const related = (side: 'blocker' | 'blocked', issueId: string) => {
    const other = side === 'blocker' ? issueBlocks.blockerId : issueBlocks.blockedId;
    const self = side === 'blocker' ? issueBlocks.blockedId : issueBlocks.blockerId;
    return db
      .select({
        id: issues.id,
        key: sql<string>`${projects.key} || '-' || ${issues.number}`,
        title: issues.title,
        status: issues.status,
      })
      .from(issueBlocks)
      .innerJoin(issues, eq(issues.id, other))
      .innerJoin(projects, eq(projects.id, issues.projectId))
      .where(eq(self, issueId))
      .orderBy(projects.key, issues.number);
  };

  async function blocksOf(issueId: string) {
    const [blockedBy, blocking] = await Promise.all([
      related('blocker', issueId),
      related('blocked', issueId),
    ]);
    return { blockedBy, blocking };
  }

  /** Whether `from` already waits, however far round, on `to`. */
  async function waitsOn(from: string, to: string): Promise<boolean> {
    const rows = await db.execute<{ found: boolean }>(sql`
      with recursive chain(id, depth) as (
        select blocker_id, 1 from issue_blocks where blocked_id = ${from}
        union
        select b.blocker_id, c.depth + 1 from issue_blocks b
          join chain c on b.blocked_id = c.id
         where c.depth < ${LOOP_SEARCH_DEPTH}
      )
      select exists (select 1 from chain where id = ${to}) as found
    `);
    return Boolean([...rows][0]?.found);
  }

  async function changed(request: FastifyRequest, issue: { id: string; projectId: string }) {
    const { workspaceId } = currentMembership(request);
    await publishEvent(db, {
      type: 'issue.updated',
      workspaceId,
      projectId: issue.projectId,
      issueId: issue.id,
      actorId: currentUser(request).id,
    });
    return blocksOf(issue.id);
  }

  serve(
    app,
    contracts['issues.blocks'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:read')] },
    async (request, { params: { issueId } }) => {
      const issue = await issueIn(currentMembership(request).workspaceId, issueId);
      return blocksOf(issue.id);
    },
  );

  serve(
    app,
    contracts['issues.addBlocker'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:update')] },
    async (request, { params: { issueId }, body: { blockerId } }) => {
      const { workspaceId } = currentMembership(request);
      const issue = await issueIn(workspaceId, issueId);
      const blocker = await issueIn(workspaceId, blockerId);
      if (blocker.id === issue.id) {
        throw ApiError.badRequest('An issue cannot wait on itself', 'self');
      }
      // The new link closes a loop if the blocker already waits on this issue.
      if (await waitsOn(blocker.id, issue.id)) {
        throw ApiError.conflict(
          'That would make a loop: it already waits on this issue',
          'blocks_loop',
        );
      }
      const [{ n } = { n: 0 }] = await db
        .select({ n: count() })
        .from(issueBlocks)
        .where(eq(issueBlocks.blockedId, issue.id));
      if (n >= BLOCKERS_MAX) {
        throw ApiError.conflict(`An issue waits on at most ${BLOCKERS_MAX} others`, 'too_many');
      }
      await db.transaction(async (tx) => {
        await tx
          .insert(issueBlocks)
          .values({
            blockerId: blocker.id,
            blockedId: issue.id,
            workspaceId,
            createdBy: currentUser(request).id,
          })
          .onConflictDoNothing();
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'issue',
          entityId: issue.id,
          eventType: 'issue.blocker_added',
          payload: { blockerId: blocker.id },
        });
      });
      return changed(request, issue);
    },
  );

  serve(
    app,
    contracts['issues.removeBlocker'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:update')] },
    async (request, { params: { issueId, blockerId } }) => {
      const { workspaceId } = currentMembership(request);
      const issue = await issueIn(workspaceId, issueId);
      if (!isUuid(blockerId)) throw ApiError.notFound('Not found');
      await db.transaction(async (tx) => {
        const gone = await tx
          .delete(issueBlocks)
          .where(and(eq(issueBlocks.blockedId, issue.id), eq(issueBlocks.blockerId, blockerId)))
          .returning({ id: issueBlocks.blockerId });
        if (gone.length === 0) return;
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'issue',
          entityId: issue.id,
          eventType: 'issue.blocker_removed',
          payload: { blockerId },
        });
      });
      return changed(request, issue);
    },
  );

  serve(
    app,
    contracts['projects.blocked'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:read')] },
    async (request, { params: { projectId } }) => {
      const { workspaceId } = currentMembership(request);
      if (!isUuid(projectId)) return { issueIds: [] };
      const rows = await db.execute<{ id: string }>(sql`
        select distinct b.blocked_id as id
          from issue_blocks b
          join issues waiting on waiting.id = b.blocked_id
          join issues blocker on blocker.id = b.blocker_id
         where b.workspace_id = ${workspaceId}
           and waiting.project_id = ${projectId}
           and blocker.status not in ('DONE', 'CANCELED')
      `);
      return { issueIds: [...rows].map((row) => row.id) };
    },
  );
}
