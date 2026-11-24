import {
  type Database,
  pgErrorCode,
  publishEvent,
  recordAudit,
  spaceReplies,
  spaces,
  spaceThreads,
  UNIQUE_VIOLATION,
} from '@robis/database';
import { can, contracts, SPACES_PER_WORKSPACE_MAX } from '@robis/shared';
import { and, count, desc, eq, isNull, max, sql } from 'drizzle-orm';
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
import { rateLimit } from '../plugins/rate-limit.ts';
import { leadingPeople, leadingReplies, sinceOf } from '../spaces/leaders.ts';
import { spaceReplyRoutes } from '../spaces/reply-routes.ts';
import {
  reactionTotal,
  type SpaceRow,
  spaceIn,
  type ThreadRow,
  threadIn,
  threadSummaries,
} from '../spaces/wire.ts';

/** Spaces, threads and replies a person may write in an hour, as on the feed. */
const WRITES_PER_HOUR = 60;
const HOUR_MS = 3_600_000;
/** Threads a space's list shows at once. */
const THREADS_SHOWN = 100;
/** How far back "top" looks for the most reacted to. */
const TOP_CANDIDATES = 300;

/**
 * Spaces: topics within the workspace where questions and ideas get a
 * thread and replies nest. Anyone who may post on the feed may start a
 * space or a thread; anyone who may comment there may reply. Starting and
 * taking down are audited without the words, as feed posts are.
 */
export async function spaceRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;
  const writeLimit = rateLimit({ name: 'space-write', limit: WRITES_PER_HOUR, windowMs: HOUR_MS });

  /** Open spaces re-read. Never fails the request. */
  async function notify(request: FastifyRequest, spaceId: string, threadId: string | null) {
    const { workspaceId } = currentMembership(request);
    try {
      await publishEvent(db, {
        type: 'space.changed',
        workspaceId,
        spaceId,
        threadId,
        actorId: currentUser(request).id,
      });
    } catch (error) {
      request.log.warn({ err: error }, 'spaces: change not published');
    }
  }

  /** Each space with how many threads it has and when it last moved. */
  async function spaceList(workspaceId: string, only?: string) {
    const lastActivity = max(spaceThreads.lastActivityAt);
    const rows = await db
      .select({ space: spaces, threadCount: count(spaceThreads.id), lastActivityAt: lastActivity })
      .from(spaces)
      .leftJoin(spaceThreads, eq(spaceThreads.spaceId, spaces.id))
      .where(and(eq(spaces.workspaceId, workspaceId), only ? eq(spaces.id, only) : undefined))
      .groupBy(spaces.id)
      .orderBy(desc(sql`coalesce(${lastActivity}, ${spaces.createdAt})`));
    return rows.map(({ space, threadCount, lastActivityAt }) => ({
      ...wireSpace(space),
      threadCount,
      lastActivityAt: lastActivityAt ? new Date(lastActivityAt) : null,
    }));
  }

  const wireSpace = (space: SpaceRow) => ({
    id: space.id,
    name: space.name,
    description: space.description,
    createdBy: space.createdBy,
    createdAt: space.createdAt,
  });

  serve(
    app,
    contracts['spaces.list'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read')] },
    async (request) => ({ spaces: await spaceList(currentMembership(request).workspaceId) }),
  );

  serve(
    app,
    contracts['spaces.create'],
    { preHandler: [requireAuth, requireMembership(db, 'post:create'), writeLimit] },
    async (request, { body }) => {
      const { workspaceId } = currentMembership(request);
      const user = currentUser(request);
      const [{ n } = { n: 0 }] = await db
        .select({ n: count() })
        .from(spaces)
        .where(eq(spaces.workspaceId, workspaceId));
      if (n >= SPACES_PER_WORKSPACE_MAX) {
        throw ApiError.conflict(
          `A workspace holds up to ${SPACES_PER_WORKSPACE_MAX} spaces`,
          'too_many_spaces',
        );
      }
      let created: SpaceRow;
      try {
        created = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(spaces)
            .values({
              workspaceId,
              name: body.name,
              description: body.description ?? '',
              createdBy: user.id,
            })
            .returning();
          await recordAudit(tx, auditActor(request), {
            workspaceId,
            entityType: 'space',
            entityId: row!.id,
            eventType: 'space.created',
            payload: { name: row!.name },
          });
          return row!;
        });
      } catch (error) {
        if (pgErrorCode(error) === UNIQUE_VIOLATION) {
          throw ApiError.conflict('There is a space by that name already', 'space_exists');
        }
        throw error;
      }
      await notify(request, created.id, null);
      return { space: { ...wireSpace(created), threadCount: 0, lastActivityAt: null } };
    },
  );

  /** A space's threads in the order asked for. */
  async function threadsOf(spaceId: string, sort: 'active' | 'new' | 'top' | 'unanswered') {
    const base = db.select().from(spaceThreads);
    if (sort === 'unanswered') {
      return base
        .where(
          and(
            eq(spaceThreads.spaceId, spaceId),
            eq(spaceThreads.kind, 'question'),
            isNull(spaceThreads.solvedReplyId),
          ),
        )
        .orderBy(desc(spaceThreads.createdAt), desc(spaceThreads.id))
        .limit(THREADS_SHOWN);
    }
    const order = sort === 'new' ? spaceThreads.createdAt : spaceThreads.lastActivityAt;
    return base
      .where(eq(spaceThreads.spaceId, spaceId))
      .orderBy(desc(order), desc(spaceThreads.id))
      .limit(sort === 'top' ? TOP_CANDIDATES : THREADS_SHOWN);
  }

  serve(
    app,
    contracts['spaces.threads'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read')] },
    async (request, { params: { spaceId }, query }) => {
      const { workspaceId } = currentMembership(request);
      const space = await spaceIn(db, workspaceId, spaceId);
      const rows: ThreadRow[] = await threadsOf(space.id, query.sort);
      let threads = await threadSummaries(db, rows);
      if (query.sort === 'top') {
        threads = threads
          .sort((a, b) => reactionTotal(b.reactions) - reactionTotal(a.reactions))
          .slice(0, THREADS_SHOWN);
      }
      const [listed] = await spaceList(workspaceId, space.id);
      return { space: listed!, threads };
    },
  );

  serve(
    app,
    contracts['spaces.createThread'],
    { preHandler: [requireAuth, requireMembership(db, 'post:create'), writeLimit] },
    async (request, { params: { spaceId }, body }) => {
      const { workspaceId } = currentMembership(request);
      const user = currentUser(request);
      const space = await spaceIn(db, workspaceId, spaceId);
      const row = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(spaceThreads)
          .values({
            workspaceId,
            spaceId: space.id,
            authorId: user.id,
            kind: body.kind,
            title: body.title,
            body: body.body ?? '',
          })
          .returning();
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'space_thread',
          entityId: created!.id,
          eventType: 'space.thread_created',
          payload: { kind: created!.kind, space: space.name },
        });
        return created!;
      });
      await notify(request, space.id, row.id);
      const [summary] = await threadSummaries(db, [row]);
      const { excerpt: _excerpt, ...rest } = summary!;
      return {
        thread: { ...rest, body: row.body, solvedReplyId: null, spaceName: space.name },
      };
    },
  );

  serve(
    app,
    contracts['spaces.deleteThread'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read')] },
    async (request, { params: { threadId } }) => {
      const { workspaceId, role } = currentMembership(request);
      const user = currentUser(request);
      const thread = await threadIn(db, workspaceId, threadId);
      const own = thread.authorId === user.id;
      if (!can(role, own ? 'post:delete_own' : 'post:delete_any')) throw ApiError.forbidden();
      await db.transaction(async (tx) => {
        // A solved thread points at one of its own replies: clear it first.
        await tx
          .update(spaceThreads)
          .set({ solvedReplyId: null })
          .where(eq(spaceThreads.id, thread.id));
        await tx.delete(spaceReplies).where(eq(spaceReplies.threadId, thread.id));
        await tx.delete(spaceThreads).where(eq(spaceThreads.id, thread.id));
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'space_thread',
          entityId: thread.id,
          eventType: 'space.thread_deleted',
          payload: { kind: thread.kind, moderated: !own },
        });
      });
      await notify(request, thread.spaceId, thread.id);
      return undefined;
    },
  );

  serve(
    app,
    contracts['spaces.leaders'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read')] },
    async (request, { query }) => {
      const { workspaceId } = currentMembership(request);
      const since = sinceOf(query.period, new Date());
      const [people, replies] = await Promise.all([
        leadingPeople(db, workspaceId, since),
        leadingReplies(db, workspaceId, since),
      ]);
      return { people, replies };
    },
  );

  await spaceReplyRoutes(app, { db, notify, writeLimit });
}
