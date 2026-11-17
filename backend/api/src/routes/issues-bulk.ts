import {
  type AuditActor,
  type Database,
  type Executor,
  type Issue,
  issueLabels,
  issues,
  labels,
  projects,
  publishEvent,
  type Tx,
} from '@robis/database';
import {
  type BULK_SKIP_REASONS,
  type BulkChange,
  can,
  contracts,
  ISSUE_LABELS_MAX,
  isUuid,
  type Permission,
  type Role,
  type UpdateIssueInput,
} from '@robis/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
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
import { applyIssueUpdate, assertAssignable, delegateOf, deleteIssueRow } from './issue-writes.ts';
import { replaceLabels } from './labels.ts';

/**
 * One change to many issues (C1). The route is open to anyone who can read
 * issues; whether each issue may take the change is decided issue by issue,
 * and an issue that may not is skipped and reported rather than failing the
 * rest. Everything that does change, changes in one transaction, under one
 * idempotency key, with one audit event per issue, written by the same code
 * as the single-issue routes.
 */

type SkipReason = (typeof BULK_SKIP_REASONS)[number];
type Target = { issue: Issue; projectKey: string; labelIds: string[] };
type Outcome = {
  changed: { id: string; projectId: string }[];
  skipped: { id: string; reason: SkipReason }[];
};

/** How long the batch waits for a row someone else holds. */
const LOCK_TIMEOUT = '5s';

/** Agents work in smaller batches than people, and never delete in bulk. */
const AGENT_BULK_MAX = 25;

/**
 * An agent's token can do in one call what a person does in a hundred
 * clicks, and its run is reviewed call by call (B6), so its reach is kept
 * small: up to 25 issues, and deleting stays one issue at a time.
 */
function assertAgentMayAsk(user: { kind: string }, count: number, change: BulkChange) {
  if (user.kind !== 'agent') return;
  if (change.kind === 'delete') {
    throw new ApiError(403, 'agent_bulk_delete', 'An agent deletes issues one at a time');
  }
  if (count > AGENT_BULK_MAX) {
    throw ApiError.badRequest(
      `An agent changes up to ${AGENT_BULK_MAX} issues at once`,
      'agent_bulk_limit',
    );
  }
}

const permissionFor = (change: BulkChange): Permission =>
  change.kind === 'delete' ? 'issue:delete' : 'issue:update';

/**
 * Whether this caller may make this change to this issue. Today a role
 * decides for every issue alike; the question is asked per issue so that a
 * narrower rule has one place to go.
 */
const mayChange = (role: Role, change: BulkChange, _issue: Issue) =>
  can(role, permissionFor(change));

/** Whether the change would leave the issue exactly as it is. */
function isNoOp(change: BulkChange, { issue, labelIds }: Target): boolean {
  switch (change.kind) {
    case 'status':
      return issue.status === change.status;
    case 'priority':
      return issue.priority === change.priority;
    case 'assignee':
      return issue.assigneeId === change.assigneeId;
    case 'addLabel':
      return labelIds.includes(change.labelId);
    case 'removeLabel':
      return !labelIds.includes(change.labelId);
    case 'delete':
      return false;
  }
}

/** A change that names someone or something must name this workspace's. */
async function assertChangeValid(db: Executor, workspaceId: string, change: BulkChange) {
  if (change.kind === 'assignee' && change.assigneeId) {
    await assertAssignable(db, workspaceId, change.assigneeId);
  }
  if (change.kind === 'addLabel' || change.kind === 'removeLabel') {
    const [label] = await db
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.id, change.labelId), eq(labels.workspaceId, workspaceId)));
    if (!label) throw ApiError.badRequest('A label is not one of this workspace’s', 'bad_label');
  }
}

/**
 * The named issues in this workspace, locked for the rest of the
 * transaction, in id order so two bulk requests cannot deadlock.
 */
async function lockTargets(tx: Tx, workspaceId: string, ids: string[]): Promise<Target[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ issue: issues, projectKey: projects.key })
    .from(issues)
    .innerJoin(projects, eq(projects.id, issues.projectId))
    .where(and(eq(issues.workspaceId, workspaceId), inArray(issues.id, ids)))
    .orderBy(asc(issues.id))
    .for('update', { of: issues });
  const attached = await tx
    .select({ issueId: issueLabels.issueId, labelId: issueLabels.labelId })
    .from(issueLabels)
    .where(
      and(
        eq(issueLabels.workspaceId, workspaceId),
        inArray(
          issueLabels.issueId,
          rows.map((row) => row.issue.id),
        ),
      ),
    );
  return rows.map((row) => ({
    ...row,
    labelIds: attached.filter((a) => a.issueId === row.issue.id).map((a) => a.labelId),
  }));
}

function fieldsOf(change: BulkChange): UpdateIssueInput {
  if (change.kind === 'status') return { status: change.status };
  if (change.kind === 'priority') return { priority: change.priority };
  if (change.kind === 'assignee') return { assigneeId: change.assigneeId };
  return {};
}

/** Make the change to one issue, recorded as the single-issue route would. */
async function applyOne(
  tx: Tx,
  actor: AuditActor,
  { change, target, agentId }: { change: BulkChange; target: Target; agentId: string | null },
) {
  const { issue, projectKey } = target;
  const key = `${projectKey}-${issue.number}`;
  const workspaceId = issue.workspaceId;

  if (change.kind === 'delete') {
    await deleteIssueRow(tx, actor, { workspaceId, issueId: issue.id, key, title: issue.title });
    return;
  }
  if (change.kind === 'addLabel' || change.kind === 'removeLabel') {
    const wanted =
      change.kind === 'addLabel'
        ? [...target.labelIds, change.labelId]
        : target.labelIds.filter((id) => id !== change.labelId);
    await replaceLabels(tx, actor, { workspaceId, issueId: issue.id, wanted });
    return;
  }
  await applyIssueUpdate(tx, actor, {
    workspaceId,
    issueId: issue.id,
    input: fieldsOf(change),
    delegateId: agentId,
    issueKey: key,
    title: issue.title,
    previous: issue,
  });
}

async function applyBulk(
  tx: Tx,
  actor: AuditActor,
  job: {
    workspaceId: string;
    role: Role;
    ids: string[];
    change: BulkChange;
    agentId: string | null;
  },
): Promise<Outcome> {
  // A big batch waits a short while for a lock, never indefinitely.
  await tx.execute(sql.raw(`set local lock_timeout = '${LOCK_TIMEOUT}'`));
  // Checked here, in the idempotent and locked transaction: a replay returns
  // what was done, and the named person or label cannot go between check
  // and write. Only when the role could make the change at all, so a caller
  // who may change nothing learns nothing from the answer.
  if (can(job.role, permissionFor(job.change))) {
    await assertChangeValid(tx, job.workspaceId, job.change);
  }
  const targets = await lockTargets(tx, job.workspaceId, job.ids.filter(isUuid));
  const byId = new Map(targets.map((target) => [target.issue.id, target]));
  const outcome: Outcome = { changed: [], skipped: [] };

  for (const id of job.ids) {
    const target = byId.get(id);
    let reason: SkipReason | null = null;
    if (!target) reason = 'not_found';
    else if (!mayChange(job.role, job.change, target.issue)) reason = 'forbidden';
    else if (isNoOp(job.change, target)) reason = 'unchanged';
    else if (job.change.kind === 'addLabel' && target.labelIds.length >= ISSUE_LABELS_MAX) {
      reason = 'too_many_labels';
    }

    if (reason || !target) {
      outcome.skipped.push({ id, reason: reason ?? 'not_found' });
      continue;
    }
    await applyOne(tx, actor, { change: job.change, target, agentId: job.agentId });
    outcome.changed.push({ id, projectId: target.issue.projectId });
  }
  return outcome;
}

export async function bulkIssueRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  serve(
    app,
    contracts['issues.bulk'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:read')] },
    async (request, { body }, reply) => {
      const user = currentUser(request);
      const { workspaceId, role } = currentMembership(request);
      // Ids compare as stored, lower case, so one issue named twice is one.
      const ids = [...new Set(body.issueIds.map((id) => id.toLowerCase()))];
      assertAgentMayAsk(user, ids.length, body.change);

      return withIdempotency(db, request, reply, 200, async () => {
        const outcome = await db.transaction((tx) =>
          applyBulk(tx, auditActor(request), {
            workspaceId,
            role,
            ids,
            change: body.change,
            agentId: delegateOf(user),
          }),
        );

        const type = body.change.kind === 'delete' ? 'issue.deleted' : 'issue.updated';
        for (const { id, projectId } of outcome.changed) {
          await publishEvent(db, { type, workspaceId, projectId, issueId: id, actorId: user.id });
        }
        return shape(contracts['issues.bulk'], {
          changed: outcome.changed.map((c) => c.id),
          skipped: outcome.skipped,
        });
      });
    },
  );
}
