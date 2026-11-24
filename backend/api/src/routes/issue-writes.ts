import {
  type AssignmentJob,
  type AuditActor,
  attachments,
  type Executor,
  enqueue,
  ISSUE_FIELDS,
  issues,
  NOTIFY_ASSIGNMENT_JOB,
  noticeWindow,
  queueAttachmentPurge,
  recordAgentChanges,
  recordAudit,
  releases,
  type Tx,
  users,
  workspaceMembers,
} from '@robis/database';
import type { UpdateIssueInput } from '@robis/shared';
import { and, eq } from 'drizzle-orm';
import { ApiError } from '../errors.ts';

/**
 * The writes an issue goes through, shared by the single-issue routes and
 * the bulk route (C1), so an edit or a delete is recorded the same way
 * however many issues it touches.
 */

/**
 * An assignee must already belong to the workspace. Skipping this would let a
 * caller probe for valid user ids and attach outsiders to internal work. And
 * an assignee is a person (B5): who answers for the work never passes to an
 * agent, which is recorded as the issue's delegate instead.
 */
export async function assertAssignable(db: Executor, workspaceId: string, assigneeId: string) {
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

/** A release, held until the change commits so it cannot ship or go meanwhile. */
async function heldRelease(tx: Tx, workspaceId: string, releaseId: string) {
  const [row] = await tx
    .select({ shippedAt: releases.shippedAt })
    .from(releases)
    .where(and(eq(releases.id, releaseId), eq(releases.workspaceId, workspaceId)))
    .for('share');
  return row ?? null;
}

/**
 * Whether an issue may move from one release to another (either may be
 * none): into one of this workspace's still to ship, and never out of one
 * that shipped, whose notes say what was in it. Each is held for the rest
 * of the transaction, so shipping waits for the change, or the change for
 * the shipping.
 */
async function assertReleaseMove(
  tx: Tx,
  workspaceId: string,
  from: string | null,
  to: string | null,
) {
  if (from && (await heldRelease(tx, workspaceId, from))?.shippedAt) {
    throw ApiError.badRequest('A shipped release keeps its issues', 'release_shipped');
  }
  if (!to) return;
  const target = await heldRelease(tx, workspaceId, to);
  if (!target) {
    throw ApiError.badRequest('That release is not one of this workspace’s', 'bad_release');
  }
  if (target.shippedAt) {
    throw ApiError.badRequest(
      'That release has shipped; it takes no more issues',
      'release_shipped',
    );
  }
}

/** The agent acting, to record as the issue's delegate; null for a person. */
export const delegateOf = (user: { id: string; kind: string }) =>
  user.kind === 'agent' ? user.id : null;

export type IssueUpdate = {
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
 * Tell someone they were given an issue (C3), in the transaction that gave
 * it: not when they took it themselves, and not when it was taken away.
 */
export async function queueAssignment(
  tx: Executor,
  actor: AuditActor,
  issueId: string,
  assigneeId: string | null | undefined,
) {
  if (!assigneeId || assigneeId === actor.id) return;
  const job: AssignmentJob = {
    issueId,
    assigneeId,
    // A rule is not a person to name in a notice (B9); Robis's own notices have none.
    actorId: actor.kind === 'rule' ? null : actor.id,
    eventId: `${issueId}:${assigneeId}:${noticeWindow()}`,
  };
  await enqueue(tx, NOTIFY_ASSIGNMENT_JOB, job);
}

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
export async function applyIssueUpdate(tx: Tx, actor: AuditActor, update: IssueUpdate) {
  const { workspaceId, issueId, input } = update;
  const [current] = await tx
    .select({
      status: issues.status,
      assigneeId: issues.assigneeId,
      releaseId: issues.releaseId,
    })
    .from(issues)
    .where(and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)))
    .for('update');

  if (!current) throw ApiError.notFound('Issue not found');
  if (input.releaseId !== undefined && input.releaseId !== current.releaseId) {
    await assertReleaseMove(tx, workspaceId, current.releaseId, input.releaseId);
  }
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
  if (input.assigneeId !== current.assigneeId) {
    await queueAssignment(tx, actor, issueId, input.assigneeId);
  }

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

/**
 * Delete an issue and record it, in the caller's transaction. Its images are
 * queued for purging first: the cascade takes the rows, not the files.
 * False when there was nothing to delete (a concurrent delete got there).
 */
export async function deleteIssueRow(
  tx: Tx,
  actor: AuditActor,
  {
    workspaceId,
    issueId,
    key,
    title,
  }: { workspaceId: string; issueId: string; key: string; title: string },
): Promise<boolean> {
  await queueAttachmentPurge(tx, eq(attachments.issueId, issueId));
  const deleted = await tx
    .delete(issues)
    .where(and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)))
    .returning({ id: issues.id });
  if (deleted.length === 0) return false;
  await recordAudit(tx, actor, {
    workspaceId,
    entityType: 'issue',
    entityId: issueId,
    eventType: 'issue.deleted',
    payload: { key, title },
  });
  return true;
}
