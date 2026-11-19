import {
  agentChanges,
  attachments,
  comments,
  type Database,
  issues,
  projects,
  publishEvent,
  queueAttachmentPurge,
  recordAudit,
  type Tx,
  users,
} from '@robis/database';
import {
  AGENT_CHANGES_SHOWN,
  contracts,
  isUuid,
  type UpdateIssueInput,
  updateIssueSchema,
} from '@robis/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
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
import { withIdempotency } from '../plugins/idempotency.ts';
import { assertParentAllowed } from './issue-tree.ts';
import { applyIssueUpdate } from './issue-writes.ts';

/**
 * An agent's changes, and undoing one (idea 6). Undo goes through the same
 * paths a person's own edit takes (the issue update, the comment removal)
 * as the admin who pressed it, so the audit trail names them; and it is
 * refused once someone has changed the thing since, so it never overwrites
 * a person's later work.
 */

type ChangeRow = typeof agentChanges.$inferSelect;
type State = 'undoable' | 'undone' | 'changed' | 'gone' | 'manual';

/** A stored value; one that will not parse (written long ago, say) reads as missing. */
const UNREADABLE = Symbol('unreadable');
function parse(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return UNREADABLE;
  }
}

/** The issues the changes are on (a comment's issue for a comment), with their keys. */
async function issuesFor(db: Database | Tx, workspaceId: string, rows: ChangeRow[]) {
  const commentIds = rows.filter((r) => r.entityType === 'comment').map((r) => r.entityId);
  const commentRows = commentIds.length
    ? await db
        .select({ id: comments.id, issueId: comments.issueId })
        .from(comments)
        .where(and(eq(comments.workspaceId, workspaceId), inArray(comments.id, commentIds)))
    : [];
  const commentIssue = new Map(commentRows.map((c) => [c.id, c.issueId]));
  const issueIds = [
    ...new Set([
      ...rows.filter((r) => r.entityType === 'issue').map((r) => r.entityId),
      ...commentRows.map((c) => c.issueId),
    ]),
  ];
  const issueRows = issueIds.length
    ? await db
        .select({
          id: issues.id,
          projectId: issues.projectId,
          number: issues.number,
          projectKey: projects.key,
          title: issues.title,
          description: issues.description,
          status: issues.status,
          priority: issues.priority,
          dueOn: issues.dueOn,
          parentId: issues.parentId,
        })
        .from(issues)
        .innerJoin(projects, eq(projects.id, issues.projectId))
        .where(and(eq(issues.workspaceId, workspaceId), inArray(issues.id, issueIds)))
    : [];
  return { commentIssue, issueById: new Map(issueRows.map((i) => [i.id, i])) };
}

/** What a change has come to: as the agent left it, put back, changed since, or gone. */
function stateOf(
  change: ChangeRow,
  now: Record<string, unknown> | undefined,
  commentExists: boolean,
): State {
  if (change.entityType === 'comment') return commentExists ? 'undoable' : 'gone';
  if (change.field === 'created') return now ? 'manual' : 'gone';
  if (!now) return 'gone';
  if (parse(change.before) === UNREADABLE || parse(change.after) === UNREADABLE) return 'gone';
  const value = JSON.stringify(now[change.field] ?? null);
  if (value === change.after) return 'undoable';
  if (value === change.before) return 'undone';
  return 'changed';
}

/** Why an undo cannot happen, said as a 409 the page can show. */
function refusal(state: State): ApiError {
  const why: Record<Exclude<State, 'undoable'>, string> = {
    undone: 'That change has already been undone.',
    changed: 'Someone has changed this since; change it back by hand if you mean to.',
    gone: 'What the agent changed has since been deleted.',
    manual: 'An issue an agent made is removed from its own page.',
  };
  return ApiError.conflict(why[state as Exclude<State, 'undoable'>], `undo_${state}`);
}

async function undoIssueField(
  tx: Tx,
  request: Parameters<typeof auditActor>[0],
  change: ChangeRow,
  issue: { projectId: string; number: number; projectKey: string; title: string },
) {
  const { workspaceId } = currentMembership(request);
  // Checked as a person's edit is: the value still fits the field, and a
  // parent put back may not make the tree go round.
  const checked = updateIssueSchema.safeParse({ [change.field]: parse(change.before) });
  if (!checked.success) throw refusal('gone');
  const input: UpdateIssueInput = checked.data;
  if (input.parentId) {
    await assertParentAllowed(tx, {
      workspaceId,
      projectId: issue.projectId,
      issueId: change.entityId,
      parentId: input.parentId,
    });
  }
  await applyIssueUpdate(tx, auditActor(request), {
    workspaceId,
    issueId: change.entityId,
    input,
    // A person's edit: the agent stays named as the last delegate.
    delegateId: null,
    issueKey: `${issue.projectKey}-${issue.number}`,
    title: issue.title,
    previous: {},
  });
}

async function undoComment(tx: Tx, request: Parameters<typeof auditActor>[0], change: ChangeRow) {
  const { workspaceId } = currentMembership(request);
  await queueAttachmentPurge(tx, eq(attachments.commentId, change.entityId));
  const [removed] = await tx
    .delete(comments)
    .where(and(eq(comments.id, change.entityId), eq(comments.workspaceId, workspaceId)))
    .returning({ issueId: comments.issueId, authorId: comments.authorId });
  if (!removed) throw refusal('gone');
  await recordAudit(tx, auditActor(request), {
    workspaceId,
    entityType: 'comment',
    entityId: change.entityId,
    eventType: 'comment.deleted',
    payload: {
      issueId: removed.issueId,
      authorId: removed.authorId,
      moderated: true,
      undoOf: change.id,
    },
  });
}

/** A stored value for the page; one that will not parse shows as none. */
function readable(value: string | null): unknown {
  const parsed = parse(value);
  return parsed === UNREADABLE ? null : parsed;
}

type Found = Awaited<ReturnType<typeof issuesFor>>;

/** One change as the agents page shows it. */
function listed(change: ChangeRow, agentName: string, { commentIssue, issueById }: Found) {
  const issueId =
    change.entityType === 'comment' ? (commentIssue.get(change.entityId) ?? null) : change.entityId;
  const issue = issueId ? issueById.get(issueId) : undefined;
  return {
    id: change.id,
    agentId: change.agentId,
    agentName,
    entityType: change.entityType as 'issue' | 'comment',
    entityId: change.entityId,
    issueId: issue ? issueId : null,
    issueKey: issue ? `${issue.projectKey}-${issue.number}` : null,
    field: change.field,
    before: readable(change.before),
    after: readable(change.after),
    at: change.at,
    state: stateOf(
      change,
      change.entityType === 'issue' ? issue : undefined,
      commentIssue.has(change.entityId),
    ),
  };
}

/** Undo one change, in its transaction: refused unless it is as the agent left it. */
async function undoInTx(
  tx: Tx,
  request: Parameters<typeof auditActor>[0],
  workspaceId: string,
  changeId: string,
) {
  const [change] = await tx
    .select()
    .from(agentChanges)
    .where(and(eq(agentChanges.id, changeId), eq(agentChanges.workspaceId, workspaceId)))
    .for('update');
  if (!change) throw ApiError.notFound('Change not found');

  await lockTarget(tx, workspaceId, change);
  const { commentIssue, issueById } = await issuesFor(tx, workspaceId, [change]);
  const issue = change.entityType === 'issue' ? issueById.get(change.entityId) : undefined;
  const state = stateOf(change, issue, commentIssue.has(change.entityId));
  if (state !== 'undoable') throw refusal(state);

  if (change.entityType === 'comment') await undoComment(tx, request, change);
  else await undoIssueField(tx, request, change, issue!);

  await tx
    .update(agentChanges)
    .set({ outcome: 'reverted', judgedAt: new Date() })
    .where(eq(agentChanges.id, change.id));
  // The issue put back, for boards and issue pages open elsewhere to hear.
  return change.entityType === 'issue' && issue
    ? { issueId: change.entityId, projectId: issue.projectId }
    : null;
}

/** Hold what the change is on until the undo commits, so a person's edit cannot slip between. */
async function lockTarget(tx: Tx, workspaceId: string, change: ChangeRow) {
  if (change.entityType === 'issue') {
    await tx
      .select({ id: issues.id })
      .from(issues)
      .where(and(eq(issues.id, change.entityId), eq(issues.workspaceId, workspaceId)))
      .for('update');
  } else {
    await tx
      .select({ id: comments.id })
      .from(comments)
      .where(and(eq(comments.id, change.entityId), eq(comments.workspaceId, workspaceId)))
      .for('update');
  }
}

export async function agentUndoRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;
  const manage = { preHandler: [requireAuth, requireMembership(db, 'agent:manage')] };

  serve(app, contracts['agents.changes'], manage, async (request) => {
    const { workspaceId } = currentMembership(request);
    const rows = await db
      .select({ change: agentChanges, agentName: users.name })
      .from(agentChanges)
      .innerJoin(users, eq(users.id, agentChanges.agentId))
      .where(eq(agentChanges.workspaceId, workspaceId))
      .orderBy(desc(agentChanges.at), desc(agentChanges.id))
      .limit(AGENT_CHANGES_SHOWN);
    const found = await issuesFor(
      db,
      workspaceId,
      rows.map((r) => r.change),
    );

    return {
      changes: rows.map(({ change, agentName }) => listed(change, agentName, found)),
    };
  });

  serve(
    app,
    contracts['agents.undoChange'],
    manage,
    async (request, { params: { changeId } }, reply) => {
      const { workspaceId } = currentMembership(request);
      if (!isUuid(changeId)) throw ApiError.notFound('Change not found');

      return withIdempotency(db, request, reply, 200, async () => {
        const put = await db.transaction((tx) => undoInTx(tx, request, workspaceId, changeId));
        if (put) {
          await publishEvent(db, {
            type: 'issue.updated',
            workspaceId,
            projectId: put.projectId,
            issueId: put.issueId,
            actorId: currentUser(request).id,
          });
        }
        return { ok: true as const };
      });
    },
  );
}
