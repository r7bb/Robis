import {
  type AuditActor,
  type Database,
  issueLabels,
  issues,
  labels,
  pgErrorCode,
  publishEvent,
  recordAudit,
  type Tx,
} from '@robis/database';
import { contracts, isUuid } from '@robis/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
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

/**
 * Labels (C1). Members make and delete them (the same people who shape
 * projects); anyone who may edit an issue sets its labels. Every change is
 * in the audit trail and goes through the idempotency ledger.
 */

const UNIQUE_VIOLATION = '23505';

/**
 * Give an issue exactly `wanted` labels, in the caller's transaction, and
 * record it. Only this workspace's labels: another's ids are refused, not
 * attached.
 */
export async function replaceLabels(
  tx: Tx,
  actor: AuditActor,
  { workspaceId, issueId, wanted }: { workspaceId: string; issueId: string; wanted: string[] },
) {
  const [issue] = await tx
    .select({ id: issues.id, projectId: issues.projectId })
    .from(issues)
    .where(and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)))
    .for('update');
  if (!issue) throw ApiError.notFound('Issue not found');

  const known = wanted.length
    ? await tx
        .select({ id: labels.id, name: labels.name })
        .from(labels)
        .where(and(eq(labels.workspaceId, workspaceId), inArray(labels.id, wanted)))
    : [];
  if (known.length !== wanted.length) {
    throw ApiError.badRequest('A label is not one of this workspace’s', 'bad_label');
  }

  // Which labels are new to the issue, for the trail and for rules (B9).
  const before = new Set(
    (
      await tx
        .select({ labelId: issueLabels.labelId })
        .from(issueLabels)
        .where(eq(issueLabels.issueId, issueId))
    ).map((row) => row.labelId),
  );
  await tx.delete(issueLabels).where(eq(issueLabels.issueId, issueId));
  if (wanted.length) {
    await tx
      .insert(issueLabels)
      .values(wanted.map((labelId) => ({ issueId, labelId, workspaceId })));
  }
  await recordAudit(tx, actor, {
    workspaceId,
    entityType: 'issue',
    entityId: issueId,
    eventType: 'issue.labels_changed',
    payload: {
      labels: known.map((label) => label.name).sort(),
      added: known
        .filter((label) => !before.has(label.id))
        .map((label) => label.name)
        .sort(),
    },
  });
  return issue;
}

export async function labelRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  serve(
    app,
    contracts['labels.list'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:read')] },
    async (request) => {
      const { workspaceId } = currentMembership(request);
      const rows = await db
        .select({
          id: labels.id,
          name: labels.name,
          colour: labels.colour,
          createdAt: labels.createdAt,
        })
        .from(labels)
        .where(eq(labels.workspaceId, workspaceId))
        .orderBy(asc(labels.name));
      return { labels: rows };
    },
  );

  serve(
    app,
    contracts['labels.create'],
    { preHandler: [requireAuth, requireMembership(db, 'project:update')] },
    async (request, { body }, reply) => {
      const { workspaceId } = currentMembership(request);
      return withIdempotency(db, request, reply, 201, async () => {
        try {
          const label = await db.transaction(async (tx) => {
            const [row] = await tx
              .insert(labels)
              .values({ workspaceId, name: body.name, colour: body.colour })
              .returning({
                id: labels.id,
                name: labels.name,
                colour: labels.colour,
                createdAt: labels.createdAt,
              });
            await recordAudit(tx, auditActor(request), {
              workspaceId,
              entityType: 'label',
              entityId: row!.id,
              eventType: 'label.created',
              payload: { name: row!.name, colour: row!.colour },
            });
            return row!;
          });
          return shape(contracts['labels.create'], { label });
        } catch (error) {
          if (pgErrorCode(error) === UNIQUE_VIOLATION) {
            throw ApiError.conflict('A label with that name exists already', 'label_exists');
          }
          throw error;
        }
      });
    },
  );

  serve(
    app,
    contracts['labels.delete'],
    { preHandler: [requireAuth, requireMembership(db, 'project:update')] },
    async (request, { params: { labelId } }) => {
      const { workspaceId } = currentMembership(request);
      if (!isUuid(labelId)) throw ApiError.notFound('Label not found');
      await db.transaction(async (tx) => {
        const [gone] = await tx
          .delete(labels)
          .where(and(eq(labels.id, labelId), eq(labels.workspaceId, workspaceId)))
          .returning({ name: labels.name });
        if (!gone) throw ApiError.notFound('Label not found');
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'label',
          entityId: labelId,
          eventType: 'label.deleted',
          payload: { name: gone.name },
        });
      });
      return undefined;
    },
  );

  serve(
    app,
    contracts['issues.setLabels'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:update')] },
    async (request, { params: { issueId }, body }, reply) => {
      const user = currentUser(request);
      const { workspaceId } = currentMembership(request);
      if (!isUuid(issueId)) throw ApiError.notFound('Issue not found');
      const wanted = [...new Set(body.labelIds)];

      return withIdempotency(db, request, reply, 200, async () => {
        const result = await db.transaction((tx) =>
          replaceLabels(tx, auditActor(request), { workspaceId, issueId, wanted }),
        );

        await publishEvent(db, {
          type: 'issue.updated',
          workspaceId,
          projectId: result.projectId,
          issueId,
          actorId: user.id,
        });
        return shape(contracts['issues.setLabels'], { labelIds: wanted });
      });
    },
  );
}
