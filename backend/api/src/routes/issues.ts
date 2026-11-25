import {
  type AuditActor,
  type Database,
  decodeCursor,
  type Executor,
  encodeCursor,
  enqueue,
  FOREIGN_KEY_VIOLATION,
  issueLabels,
  issues,
  pgErrorCode,
  projects,
  publishEvent,
  recordAgentChanges,
  recordAudit,
  type Tx,
  users,
  workspaces,
} from '@robis/database';
import {
  type BoardFilter,
  type CreateIssueInput,
  contracts,
  isUuid,
  positionBetween,
  TRIAGE_JOB,
  type TriageJob,
  type UpdateIssueInput,
} from '@robis/shared';
import { and, asc, desc, eq, gt, inArray, type SQL, sql } from 'drizzle-orm';
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
import type { SuggestionClient } from '../suggestions.ts';
import { assertCycleOn } from './cycles.ts';
import { assertParentAllowed, loadRelatives } from './issue-tree.ts';
import {
  applyIssueUpdate,
  assertAssignable,
  delegateOf,
  deleteIssueRow,
  queueAssignment,
} from './issue-writes.ts';
import { loadProject } from './projects.ts';

/** Tenant-scoped issue lookup. See the note on `loadProject`. */
async function loadIssue(db: Executor, workspaceId: string, issueId: string) {
  if (!isUuid(issueId)) throw ApiError.notFound('Issue not found');

  const [issue] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)))
    .limit(1);

  if (!issue) throw ApiError.notFound('Issue not found');
  return issue;
}

/**
 * Have the workspace's triage agent, if it has one, look at a new issue
 * (B5). Queued in the transaction that files it, so there is no issue the
 * agent never hears of; not for an issue the agent filed itself.
 */
async function queueTriage(tx: Tx, job: TriageJob, filedBy: string) {
  const [workspace] = await tx
    .select({ triageAgentId: workspaces.triageAgentId })
    .from(workspaces)
    .where(eq(workspaces.id, job.workspaceId))
    .limit(1);
  const agentId = workspace?.triageAgentId;
  if (agentId && agentId !== filedBy) await enqueue(tx, TRIAGE_JOB, job);
}

/**
 * A cycle removed between the check and the save: said as for one not on
 * this board, rather than a server error. (A release is held for the save,
 * so it cannot go meanwhile.) Anything else, as it was.
 */
function removedMeanwhile(input: UpdateIssueInput, error: unknown): unknown {
  if (input.cycleId && pgErrorCode(error) === FOREIGN_KEY_VIOLATION) {
    return ApiError.badRequest('That cycle is not on this board', 'bad_cycle');
  }
  return error;
}

/**
 * File an issue in the caller's transaction: take the project's next number,
 * check its parent, put it at the top of the board, and record it.
 */
export async function fileIssue(
  tx: Tx,
  actor: AuditActor,
  {
    user,
    workspaceId,
    projectId,
    input,
  }: {
    user: { id: string; kind: string };
    workspaceId: string;
    projectId: string;
    input: CreateIssueInput;
  },
) {
  // The tree lock before the project row, the order every parent change takes.
  if (input.parentId) {
    await assertParentAllowed(tx, {
      workspaceId,
      projectId,
      issueId: null,
      parentId: input.parentId,
    });
  }
  /*
   * Reserve the next issue number by incrementing the counter in place.
   * `UPDATE ... RETURNING` takes a row-level lock, so concurrent creates
   * in the same project queue behind each other and each gets a distinct
   * number. Reading the max issue number and adding one would race.
   */
  const [bumped] = await tx
    .update(projects)
    .set({ issueCounter: sql`${projects.issueCounter} + 1` })
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
    .returning({ number: projects.issueCounter, key: projects.key });

  if (!bumped) throw ApiError.notFound('Project not found');

  // A new card goes to the top of the board: before the project's first.
  const [first] = await tx
    .select({ position: issues.position })
    .from(issues)
    .where(eq(issues.projectId, projectId))
    .orderBy(asc(issues.position))
    .limit(1);

  const [created] = await tx
    .insert(issues)
    .values({
      // Falls back to the database default when the client did not
      // choose one.
      ...(input.id ? { id: input.id } : {}),
      workspaceId,
      projectId,
      number: bumped.number,
      title: input.title,
      description: input.description ?? null,
      status: input.status,
      priority: input.priority,
      assigneeId: input.assigneeId ?? null,
      dueOn: input.dueOn ?? null,
      parentId: input.parentId ?? null,
      delegateId: delegateOf(user),
      position: positionBetween(null, first?.position ?? null),
      createdBy: user.id,
    })
    .returning();

  await recordAudit(tx, actor, {
    workspaceId,
    entityType: 'issue',
    entityId: created!.id,
    eventType: 'issue.created',
    payload: { key: `${bumped.key}-${bumped.number}`, title: created!.title },
  });
  await queueTriage(tx, { workspaceId, issueId: created!.id }, user.id);
  await queueAssignment(tx, actor, created!.id, created!.assigneeId);
  if (user.kind === 'agent') {
    await recordAgentChanges(tx, [
      {
        workspaceId,
        agentId: user.id,
        entityType: 'issue',
        entityId: created!.id,
        field: 'created',
        before: null,
        after: null,
      },
    ]);
  }

  return { ...created!, key: `${bumped.key}-${bumped.number}` };
}

/** What the board's filter asks of the list, as conditions on the issues. */
function listFilters(
  db: Database,
  workspaceId: string,
  projectId: string,
  query: BoardFilter,
): SQL[] {
  const filters: SQL[] = [eq(issues.projectId, projectId), eq(issues.workspaceId, workspaceId)];
  if (query.status) filters.push(eq(issues.status, query.status));
  if (query.assigneeId) filters.push(eq(issues.assigneeId, query.assigneeId));
  if (query.priority) filters.push(eq(issues.priority, query.priority));
  if (query.cycleId) filters.push(eq(issues.cycleId, query.cycleId));
  if (query.releaseId) filters.push(eq(issues.releaseId, query.releaseId));
  if (query.carried) filters.push(gt(issues.carriedOver, 0));
  if (query.labelId) {
    filters.push(
      inArray(
        issues.id,
        db
          .select({ id: issueLabels.issueId })
          .from(issueLabels)
          .where(
            and(eq(issueLabels.labelId, query.labelId), eq(issueLabels.workspaceId, workspaceId)),
          ),
      ),
    );
  }
  return filters;
}

export async function issueRoutes(
  app: FastifyInstance,
  opts: { db: Database; suggestions: SuggestionClient },
) {
  const { db, suggestions } = opts;

  /**
   * Issues that look like the one being written.
   *
   * A GET with the draft in the query string rather than a POST: it reads
   * nothing and changes nothing, so it should be cacheable and safe to
   * retry. The title is short by schema, so it fits.
   *
   * Membership is checked here, by the same `requireMembership` as every
   * other route. The ML service trusts whatever workspace id it is handed,
   * so this is the only place that decides whether the caller may ask.
   */
  /*
   * Both hints for a draft, from one call to the suggestion service per
   * settled title (stage 3, item 27). Caught here as well as inside the
   * client: whatever the client is, and however it breaks, a person filing
   * an issue never sees an error from a hint.
   */
  serve(
    app,
    contracts['issues.suggestions'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:read')] },
    async (request, { query }) => {
      const { workspaceId } = currentMembership(request);

      try {
        const { similar, triage } = await suggestions.suggest(
          workspaceId,
          query.title,
          query.description,
          { requestId: request.id },
        );
        return { similar, suggestion: triage };
      } catch (error) {
        request.log.warn({ err: error }, 'suggestion lookup failed');
        return { similar: [], suggestion: null };
      }
    },
  );

  serve(
    app,
    contracts['issues.list'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:read')] },
    async (request, { params: { projectId }, query }) => {
      const { workspaceId } = currentMembership(request);

      const project = await loadProject(db, workspaceId, projectId);

      const filters = listFilters(db, workspaceId, projectId, query);

      /*
       * Keyset paging: take rows strictly "after" the cursor in the sort
       * order, rather than skipping a count. `(created_at, id) < (...)` is a
       * row comparison, which Postgres can satisfy straight from the
       * composite index -- and `id` is the tiebreaker, because two issues
       * created in the same millisecond would otherwise page unstably.
       */
      const cursorId = decodeCursor(query.cursor);
      if (cursorId) {
        // The sort key is read back from the row rather than carried in the
        // cursor, so no timestamp precision is lost in transit.
        filters.push(
          sql`(${issues.createdAt}, ${issues.id}) < (
            select created_at, id from issues where id = ${cursorId}::uuid
          )`,
        );
      }

      const rows = await db
        .select({
          id: issues.id,
          // The offline store keys rows by project, so the client needs this
          // even though it is implied by the request path.
          projectId: issues.projectId,
          number: issues.number,
          title: issues.title,
          status: issues.status,
          priority: issues.priority,
          assigneeId: issues.assigneeId,
          position: issues.position,
          dueOn: issues.dueOn,
          parentId: issues.parentId,
          cycleId: issues.cycleId,
          releaseId: issues.releaseId,
          carriedOver: issues.carriedOver,
          assigneeName: users.name,
          createdAt: issues.createdAt,
          updatedAt: issues.updatedAt,
        })
        .from(issues)
        .leftJoin(users, eq(users.id, issues.assigneeId))
        .where(and(...filters))
        .orderBy(desc(issues.createdAt), desc(issues.id))
        .limit(query.limit);

      const last = rows.at(-1);
      // Each issue's labels, in one query for the page (C1).
      const tagged = rows.length
        ? await db
            .select({ issueId: issueLabels.issueId, labelId: issueLabels.labelId })
            .from(issueLabels)
            .where(
              and(
                eq(issueLabels.workspaceId, workspaceId),
                inArray(
                  issueLabels.issueId,
                  rows.map((r) => r.id),
                ),
              ),
            )
        : [];

      return {
        issues: rows.map((r) => ({
          ...r,
          key: `${project.key}-${r.number}`,
          labelIds: tagged.filter((t) => t.issueId === r.id).map((t) => t.labelId),
        })),
        // A full page implies there may be more; a short page is the end.
        nextCursor: rows.length === query.limit && last ? encodeCursor(last.id) : null,
      };
    },
  );

  serve(
    app,
    contracts['issues.create'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:create')] },
    async (request, { params: { projectId }, body: input }, reply) => {
      const user = currentUser(request);
      const { workspaceId } = currentMembership(request);

      await loadProject(db, workspaceId, projectId);
      if (input.assigneeId) await assertAssignable(db, workspaceId, input.assigneeId);

      return withIdempotency(db, request, reply, 201, async () => {
        const issue = await db.transaction((tx) =>
          fileIssue(tx, auditActor(request), { user, workspaceId, projectId, input }),
        );

        await publishEvent(db, {
          type: 'issue.created',
          workspaceId,
          projectId,
          issueId: issue.id,
          actorId: user.id,
        });

        return shape(contracts['issues.create'], { issue });
      });
    },
  );

  serve(
    app,
    contracts['issues.get'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:read')] },
    async (request, { params: { issueId } }) => {
      const { workspaceId } = currentMembership(request);

      const issue = await loadIssue(db, workspaceId, issueId);
      const project = await loadProject(db, workspaceId, issue.projectId);
      const tagged = await db
        .select({ labelId: issueLabels.labelId })
        .from(issueLabels)
        .where(and(eq(issueLabels.issueId, issueId), eq(issueLabels.workspaceId, workspaceId)));

      const relatives = await loadRelatives(db, {
        workspaceId,
        issueId,
        parentId: issue.parentId,
        projectKey: project.key,
      });

      return {
        issue: {
          ...issue,
          key: `${project.key}-${issue.number}`,
          labelIds: tagged.map((t) => t.labelId),
          ...relatives,
        },
      };
    },
  );

  serve(
    app,
    contracts['issues.update'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:update')] },
    async (request, { params: { issueId }, body: input }, reply) => {
      const user = currentUser(request);
      const { workspaceId } = currentMembership(request);

      const before = await loadIssue(db, workspaceId, issueId);

      if (input.assigneeId) await assertAssignable(db, workspaceId, input.assigneeId);
      // A cycle of its own board only: another board's, or another workspace's, is not found.
      if (input.cycleId) await assertCycleOn(db, workspaceId, before.projectId, input.cycleId);

      // The key is resolved and stored now rather than joined at read time,
      // so the entry still names the issue after the issue is deleted.
      const project = await loadProject(db, workspaceId, before.projectId);

      return withIdempotency(db, request, reply, 200, async () => {
        const updated = await db
          .transaction(async (tx) => {
            if (input.parentId) {
              await assertParentAllowed(tx, {
                workspaceId,
                projectId: before.projectId,
                issueId,
                parentId: input.parentId,
              });
            }
            return applyIssueUpdate(tx, auditActor(request), {
              workspaceId,
              issueId,
              input,
              delegateId: delegateOf(user),
              issueKey: `${project.key}-${before.number}`,
              title: before.title,
              previous: before,
            });
          })
          .catch((error: unknown) => {
            throw removedMeanwhile(input, error);
          });

        await publishEvent(db, {
          type: 'issue.updated',
          workspaceId,
          projectId: before.projectId,
          issueId: issueId,
          actorId: user.id,
        });

        // With its key, as the other issue answers have it.
        return shape(contracts['issues.update'], {
          issue: { ...updated, key: `${project.key}-${updated.number}` },
        });
      });
    },
  );

  serve(
    app,
    contracts['issues.delete'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:delete')] },
    async (request, { params: { issueId } }) => {
      const { workspaceId } = currentMembership(request);

      const issue = await loadIssue(db, workspaceId, issueId);
      const project = await loadProject(db, workspaceId, issue.projectId);

      await db.transaction(async (tx) => {
        const deleted = await deleteIssueRow(tx, auditActor(request), {
          workspaceId,
          issueId,
          key: `${project.key}-${issue.number}`,
          title: issue.title,
        });
        // A concurrent delete got there first and recorded it.
        if (!deleted) throw ApiError.notFound('Issue not found');
      });

      await publishEvent(db, {
        type: 'issue.deleted',
        workspaceId,
        projectId: issue.projectId,
        issueId,
        actorId: currentUser(request).id,
      });

      return undefined;
    },
  );
}
