import { randomBytes } from 'node:crypto';
import {
  automationRules,
  automationRuns,
  type Database,
  recordAudit,
  workspaceMembers,
} from '@robis/database';
import {
  AUTOMATION_RULES_MAX,
  type AutomationAction,
  type AutomationCondition,
  contracts,
  isUuid,
} from '@robis/shared';
import { and, count, desc, eq, gte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import { auditActor, currentMembership, requireAuth, requireMembership } from '../plugins/authz.ts';

/**
 * Managing automation rules (B9): administrators add, change and remove
 * them, each change audited; what a rule does is in its runs and, for
 * every action it took, in the trail under the rule's own name.
 */

const RUNS_SHOWN = 50;
const RECENT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

type Row = typeof automationRules.$inferSelect;

async function runCounts(db: Database, workspaceId: string) {
  const since = new Date(Date.now() - RECENT_DAYS * DAY_MS);
  const rows = await db
    .select({ ruleId: automationRuns.ruleId, outcome: automationRuns.outcome, n: count() })
    .from(automationRuns)
    .where(and(eq(automationRuns.workspaceId, workspaceId), gte(automationRuns.at, since)))
    .groupBy(automationRuns.ruleId, automationRuns.outcome);
  return (ruleId: string, outcome: string) =>
    rows.find((row) => row.ruleId === ruleId && row.outcome === outcome)?.n ?? 0;
}

function wire(row: Row, counted: (ruleId: string, outcome: string) => number) {
  return {
    id: row.id,
    name: row.name,
    trigger: row.trigger as 'issue.created' | 'issue.status_changed' | 'issue.label_added',
    conditions: row.conditions as AutomationCondition[],
    action: row.action as AutomationAction,
    enabled: row.enabled,
    createdAt: row.createdAt,
    runs: {
      applied: counted(row.id, 'applied'),
      unmatched: counted(row.id, 'unmatched'),
      stopped: counted(row.id, 'stopped'),
      failed: counted(row.id, 'failed'),
    },
  };
}

/**
 * A webhook action gets a secret to sign with, made here (never chosen by
 * the client), kept when the rule is changed and the address stays put.
 */
function withSecret(action: AutomationAction, previous?: unknown): AutomationAction {
  if (action.kind !== 'webhook') return action;
  const before = previous as { kind?: string; secret?: string } | undefined;
  const secret =
    before?.kind === 'webhook' && before.secret
      ? before.secret
      : randomBytes(24).toString('base64url');
  return { ...action, secret };
}

/** An assign action may name only someone in the workspace. */
async function checkAction(
  db: Database,
  workspaceId: string,
  action: AutomationAction | undefined,
) {
  if (action?.kind !== 'assign' || action.userId === null) return;
  const [member] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, action.userId),
      ),
    );
  if (!member) throw ApiError.badRequest('That person is not in this workspace', 'not_a_member');
}

async function ruleIn(db: Database, workspaceId: string, ruleId: string): Promise<Row> {
  if (!isUuid(ruleId)) throw ApiError.notFound('Rule not found');
  const [row] = await db
    .select()
    .from(automationRules)
    .where(and(eq(automationRules.id, ruleId), eq(automationRules.workspaceId, workspaceId)));
  if (!row) throw ApiError.notFound('Rule not found');
  return row;
}

export async function automationRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;
  const guard = { preHandler: [requireAuth, requireMembership(db, 'automation:manage')] };

  serve(app, contracts['automations.list'], guard, async (request) => {
    const { workspaceId } = currentMembership(request);
    const rows = await db
      .select()
      .from(automationRules)
      .where(eq(automationRules.workspaceId, workspaceId))
      .orderBy(desc(automationRules.createdAt));
    const counted = await runCounts(db, workspaceId);
    return { rules: rows.map((row) => wire(row, counted)) };
  });

  serve(app, contracts['automations.create'], guard, async (request, { body }) => {
    const { workspaceId } = currentMembership(request);
    const actor = auditActor(request);
    await checkAction(db, workspaceId, body.action);
    const created = await db.transaction(async (tx) => {
      const [{ n }] = (await tx
        .select({ n: count() })
        .from(automationRules)
        .where(eq(automationRules.workspaceId, workspaceId))) as [{ n: number }];
      if (n >= AUTOMATION_RULES_MAX) {
        throw ApiError.conflict(
          `A workspace keeps at most ${AUTOMATION_RULES_MAX} rules`,
          'too_many_rules',
        );
      }
      const [row] = await tx
        .insert(automationRules)
        .values({ workspaceId, ...body, action: withSecret(body.action), createdBy: actor.id })
        .returning();
      await recordAudit(tx, actor, {
        workspaceId,
        entityType: 'automation',
        entityId: row!.id,
        eventType: 'automation.created',
        payload: {
          name: row!.name,
          trigger: row!.trigger,
          action: (row!.action as AutomationAction).kind,
        },
      });
      return row!;
    });
    return { rule: wire(created, () => 0) };
  });

  serve(app, contracts['automations.update'], guard, async (request, { params, body }) => {
    const { workspaceId } = currentMembership(request);
    const existing = await ruleIn(db, workspaceId, params.ruleId);
    await checkAction(db, workspaceId, body.action);
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(automationRules)
        .set({
          ...body,
          ...(body.action ? { action: withSecret(body.action, existing.action) } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(eq(automationRules.id, params.ruleId), eq(automationRules.workspaceId, workspaceId)),
        )
        .returning();
      await recordAudit(tx, auditActor(request), {
        workspaceId,
        entityType: 'automation',
        entityId: params.ruleId,
        eventType: 'automation.updated',
        payload: { name: row!.name, fields: Object.keys(body) },
      });
      return row!;
    });
    return { rule: wire(updated, await runCounts(db, workspaceId)) };
  });

  serve(app, contracts['automations.delete'], guard, async (request, { params }) => {
    const { workspaceId } = currentMembership(request);
    const rule = await ruleIn(db, workspaceId, params.ruleId);
    await db.transaction(async (tx) => {
      await tx.delete(automationRules).where(eq(automationRules.id, rule.id));
      await recordAudit(tx, auditActor(request), {
        workspaceId,
        entityType: 'automation',
        entityId: rule.id,
        eventType: 'automation.deleted',
        payload: { name: rule.name },
      });
    });
    return undefined;
  });

  serve(app, contracts['automations.runs'], guard, async (request, { params }) => {
    const { workspaceId } = currentMembership(request);
    await ruleIn(db, workspaceId, params.ruleId);
    const runs = await db
      .select({
        eventId: automationRuns.eventId,
        depth: automationRuns.depth,
        outcome: automationRuns.outcome,
        note: automationRuns.note,
        at: automationRuns.at,
      })
      .from(automationRuns)
      .where(eq(automationRuns.ruleId, params.ruleId))
      .orderBy(desc(automationRuns.at))
      .limit(RUNS_SHOWN);
    return {
      runs: runs.map((run) => ({
        ...run,
        outcome: run.outcome as 'applied' | 'unmatched' | 'own_change' | 'stopped' | 'failed',
      })),
    };
  });
}
