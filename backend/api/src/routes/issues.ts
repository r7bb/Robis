import {
  type AuditActor,
  attachments,
  type Database,
  decodeCursor,
  type Executor,
  encodeCursor,
  enqueue,
  ISSUE_FIELDS,
  issueLabels,
  issues,
  projects,
  publishEvent,
  queueAttachmentPurge,
  recordAgentChanges,
  recordAudit,
  type Tx,
  users,
  workspaceMembers,
  workspaces,
} from '@robis/database';
import {
  contracts,
  isUuid,
  positionBetween,
  TRIAGE_JOB,
  type TriageJob,
  type UpdateIssueInput,
} from '@robis/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
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
 * An assignee must already belong to the workspace. Skipping this would let a
 * caller probe for valid user ids and attach outsiders to internal work. And
 * an assignee is a person (B5): who answers for the work never passes to an
 * agent, which is recorded as the issue's delegate instead.
 */
async function assertAssignable(db: Executor, workspaceId: string, assigneeId: string) {
  const [member] = await db
    .select({ userId: workspaceMembers.userId, kind: users.kind })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, assigneeId)),
    )
    .limit(1);

  if (!member)
    throw ApiError.badRequest('Assignee is not a member of this workspace', 'bad_assignee');
  if (member.kind === 'agent') {
    throw ApiError.badRequest(
      'An agent cannot be an assignee; a person answers for the work',
      'assignee_not_person',
    );
  }
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

/** The agent acting, to record as the issue's delegate; null for a person. */
const delegateOf = (user: { id: string; kind: string }) => (user.kind === 'agent' ? user.id : null);

type IssueUpdate = {
  workspaceId: string;
  issueId: string;
  input: UpdateIssueInput;
  /** The acting agent, or null for a person, who leaves the last agent named. */
  delegateId: string | null;
  /** Resolved now so the trail still names the issue after it is deleted. */
  issueKey: string;
  title: string;
  /** The issue as it was, for an agent's change to be judged against later (B6). */
  previous: Record<string, unknown>;
};

/**
 * Apply an edit and record it, in the caller's transaction.
 *
 * The status being moved *from* is read again here, under a row lock: a copy
 * loaded before the transaction would let two people moving the same issue
 * at once both record leaving the same column. A status move keeps its own
 * event type, because it is what the activity feed narrates ("moved WEB-4 to
 * done"); any other edit is `issue.updated` with the names of the fields
 * touched, not their new text, which the trail has no reason to copy.
 */
async function applyIssueUpdate(tx: Tx, actor: AuditActor, update: IssueUpdate) {
  const { workspaceId, issueId, input } = update;
  const [current] = await tx
    .select({ status: issues.status })
    .from(issues)
    .where(and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)))
    .for('update');

  if (!current) throw ApiError.notFound('Issue not found');
  const statusChanged = input.status !== undefined && input.status !== current.status;

  const [row] = await tx
    .update(issues)
    .set({
      ...input,
      ...(update.delegateId ? { delegateId: update.delegateId } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)))
    .returning();

  await recordAudit(tx, actor, {
    workspaceId,
    entityType: 'issue',
    entityId: issueId,
    eventType: statusChanged ? 'issue.status_changed' : 'issue.updated',
    payload: {
      key: update.issueKey,
      title: update.title,
      fields: Object.keys(input),
      ...(statusChanged ? { from: current.status, to: input.status } : {}),
    },
  });

  if (!row) throw ApiError.notFound('Issue not found');

  // What an agent changed, with the value before, so a person's later undo
  // can be told from an edit (B6).
  if (update.delegateId) {
    await recordAgentChanges(
      tx,
      ISSUE_FIELDS.filter((field) => input[field] !== undefined).map((field) => ({
        workspaceId,
        agentId: update.delegateId!,
        entityType: 'issue' as const,
        entityId: issueId,
        field,
        before: update.previous[field] ?? null,
        after: input[field] ?? null,
      })),
    );
  }
  return row;
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

      const filters = [eq(issues.projectId, projectId), eq(issues.workspaceId, workspaceId)];
      if (query.status) filters.push(eq(issues.status, query.status));
      if (query.assigneeId) filters.push(eq(issues.assigneeId, query.assigneeId));

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
        const issue = await db.transaction(async (tx) => {
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
              delegateId: delegateOf(user),
              position: positionBetween(null, first?.position ?? null),
              createdBy: user.id,
            })
            .returning();

          await recordAudit(tx, auditActor(request), {
            workspaceId,
            entityType: 'issue',
            entityId: created!.id,
            eventType: 'issue.created',
            payload: { key: `${bumped.key}-${bumped.number}`, title: created!.title },
          });
          await queueTriage(tx, { workspaceId, issueId: created!.id }, user.id);
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
        });

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

      return {
        issue: {
          ...issue,
          key: `${project.key}-${issue.number}`,
          labelIds: tagged.map((t) => t.labelId),
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

      // The key is resolved and stored now rather than joined at read time,
      // so the entry still names the issue after the issue is deleted.
      const project = await loadProject(db, workspaceId, before.projectId);

      return withIdempotency(db, request, reply, 200, async () => {
        const updated = await db.transaction((tx) =>
          applyIssueUpdate(tx, auditActor(request), {
            workspaceId,
            issueId,
            input,
            delegateId: delegateOf(user),
            issueKey: `${project.key}-${before.number}`,
            title: before.title,
            previous: before,
          }),
        );

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
        // Before the delete: the cascade takes the rows, not the files.
        await queueAttachmentPurge(tx, eq(attachments.issueId, issueId));

        const deleted = await tx
          .delete(issues)
          .where(and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)))
          .returning({ id: issues.id });

        // A concurrent delete got there first and recorded it.
        if (deleted.length === 0) throw ApiError.notFound('Issue not found');

        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'issue',
          entityId: issueId,
          eventType: 'issue.deleted',
          payload: { key: `${project.key}-${issue.number}`, title: issue.title },
        });
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
