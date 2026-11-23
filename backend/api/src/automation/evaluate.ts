import {
  AUTOMATION_JOB,
  AUTOMATION_WEBHOOK_JOB,
  type AuditActor,
  type AutomationJob,
  auditEvents,
  automationRules,
  automationRuns,
  channels,
  comments,
  type Database,
  enqueue,
  issueLabels,
  issues,
  labels,
  messages,
  notify,
  projects,
  publishEvent,
  recordAudit,
  type Tx,
  workspaceMembers,
} from '@robis/database';
import {
  AUTOMATION_MAX_DEPTH,
  type AutomationAction,
  type AutomationCondition,
} from '@robis/shared';
import { and, eq } from 'drizzle-orm';
import { applyIssueUpdate } from '../routes/issue-writes.ts';

/**
 * Running automation rules (B9) for one audit event. For each enabled rule
 * listening to the trigger, one outcome is decided and recorded, with the
 * action in the same transaction, under a unique (rule, event) row: a job
 * retried after it applied finds the row and does nothing again.
 *
 * Outcomes: `own_change` (the event was this rule's own doing, so it never
 * triggers itself), `stopped` (a chain of rules reached the depth limit),
 * `unmatched` (a condition did not hold), `applied`, or `failed` (the
 * action could not be done, with why in the note).
 */

export { AUTOMATION_JOB };

type Rule = typeof automationRules.$inferSelect;
type Event = {
  id: string;
  entityId: string;
  actorId: string | null;
  actorKind: string;
  payload: string;
};
type Issue = {
  id: string;
  projectId: string;
  key: string;
  title: string;
  status: string;
  priority: string;
  assigneeId: string | null;
  createdBy: string | null;
  labels: string[];
};

async function issueOf(db: Database, workspaceId: string, issueId: string): Promise<Issue | null> {
  const [row] = await db
    .select({
      id: issues.id,
      projectId: issues.projectId,
      projectKey: projects.key,
      number: issues.number,
      title: issues.title,
      status: issues.status,
      priority: issues.priority,
      assigneeId: issues.assigneeId,
      createdBy: issues.createdBy,
    })
    .from(issues)
    .innerJoin(projects, eq(projects.id, issues.projectId))
    .where(and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)));
  if (!row) return null;
  const names = await db
    .select({ name: labels.name })
    .from(issueLabels)
    .innerJoin(labels, eq(labels.id, issueLabels.labelId))
    .where(eq(issueLabels.issueId, issueId));
  const { projectKey, number, ...rest } = row;
  return { ...rest, key: `${projectKey}-${number}`, labels: names.map((l) => l.name) };
}

/** Whether every condition holds; for a label added, `label` means the added ones. */
export function matches(
  conditions: readonly AutomationCondition[],
  issue: Issue,
  added: readonly string[] | null,
): boolean {
  return conditions.every(({ field, op, value }) => {
    const wanted = value.toLowerCase();
    if (field === 'label') {
      const present = (added ?? issue.labels).some((name) => name.toLowerCase() === wanted);
      return op === 'is_not' ? !present : present;
    }
    const actual = (
      field === 'assignee' ? (issue.assigneeId ?? 'nobody') : issue[field]
    ).toLowerCase();
    if (op === 'contains') return actual.includes(wanted);
    return op === 'is' ? actual === wanted : actual !== wanted;
  });
}

/** Why a rule does not act on this event, or null when it may. */
function holdBack(
  rule: Rule,
  event: Event,
  job: AutomationJob,
): { outcome: string; note: string } | null {
  if (event.actorKind === 'rule' && event.actorId === rule.id) {
    return { outcome: 'own_change', note: 'This rule made the change, so it does not act on it.' };
  }
  if (job.depth >= AUTOMATION_MAX_DEPTH) {
    return {
      outcome: 'stopped',
      note: `A chain of rules stopped here, ${AUTOMATION_MAX_DEPTH} rules deep, so rules cannot set each other off for ever.`,
    };
  }
  return null;
}

type Change = 'issue' | 'comment' | { messageId: string; channelId: string } | 'quiet';

/** Whether someone is still in the workspace. */
async function stillHere(tx: Tx, workspaceId: string, userId: string | null) {
  if (!userId) return false;
  const [member] = await tx
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  return member !== undefined;
}

/** The actions that tell someone or something else, rather than change the issue. */
async function applyOutward(tx: Tx, rule: Rule, issue: Issue, job: AutomationJob): Promise<Change> {
  const action = rule.action as AutomationAction;
  if (action.kind === 'notify') {
    const to = action.who === 'assignee' ? issue.assigneeId : issue.createdBy;
    if (!(await stillHere(tx, rule.workspaceId, to)))
      throw new Error(`The issue has no ${action.who} in the workspace to tell.`);
    await notify(tx, [
      {
        userId: to!,
        workspaceId: rule.workspaceId,
        actorId: null,
        kind: 'nudge',
        entityType: 'issue',
        entityId: issue.id,
        dedupeKey: `automation:${rule.id}:${job.eventId}`,
        payload: { title: `${issue.key}: ${rule.name}`, body: action.message, issueId: issue.id },
      },
    ]);
    return 'quiet';
  }
  if (action.kind === 'post_to_channel') {
    if (!rule.createdBy)
      throw new Error('The person who wrote this rule has left, so it cannot post.');
    const [channel] = await tx
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.id, action.channelId), eq(channels.workspaceId, rule.workspaceId)));
    if (!channel) throw new Error('The channel this rule posts to is gone.');
    const [row] = await tx
      .insert(messages)
      .values({
        workspaceId: rule.workspaceId,
        channelId: channel.id,
        authorId: rule.createdBy,
        body: `${action.body} (${issue.key}, by the automation “${rule.name}”)`,
      })
      .returning({ id: messages.id });
    return { messageId: row!.id, channelId: channel.id };
  }
  // A webhook: the worker sends it, and may retry; the job holds ids only.
  await enqueue(tx, AUTOMATION_WEBHOOK_JOB, {
    ruleId: rule.id,
    workspaceId: rule.workspaceId,
    eventId: job.eventId,
    trigger: job.trigger,
    issueId: issue.id,
    issueKey: issue.key,
  });
  return 'quiet';
}

/** Do the rule's one thing, as the rule. Throws, with a reason, when it cannot. */
async function applyAction(
  tx: Tx,
  rule: Rule,
  issue: Issue,
  actor: AuditActor,
  job: AutomationJob,
): Promise<Change> {
  const action = rule.action as AutomationAction;
  if (action.kind === 'notify' || action.kind === 'post_to_channel' || action.kind === 'webhook') {
    return applyOutward(tx, rule, issue, job);
  }
  if (action.kind === 'comment') {
    if (!rule.createdBy)
      throw new Error('The person who wrote this rule has left, so it cannot comment.');
    const [row] = await tx
      .insert(comments)
      .values({
        workspaceId: rule.workspaceId,
        issueId: issue.id,
        authorId: rule.createdBy,
        body: `${action.body}\n\n(Posted by the automation “${rule.name}”.)`,
      })
      .returning({ id: comments.id });
    await recordAudit(tx, actor, {
      workspaceId: rule.workspaceId,
      entityType: 'comment',
      entityId: row!.id,
      eventType: 'comment.created',
      payload: { issueId: issue.id, rule: rule.name },
    });
    return 'comment';
  }
  const input =
    action.kind === 'set_status'
      ? { status: action.status }
      : action.kind === 'set_priority'
        ? { priority: action.priority }
        : { assigneeId: action.userId };
  if (action.kind === 'assign' && action.userId) {
    const [member] = await tx
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, rule.workspaceId),
          eq(workspaceMembers.userId, action.userId),
        ),
      );
    if (!member) throw new Error('The person this rule assigns to has left the workspace.');
  }
  await applyIssueUpdate(tx, actor, {
    workspaceId: rule.workspaceId,
    issueId: issue.id,
    issueKey: issue.key,
    title: issue.title,
    input: input as Parameters<typeof applyIssueUpdate>[2]['input'],
    // A rule is no agent: nobody to name as the delegate, nothing to judge later.
    delegateId: null,
    previous: { status: issue.status, priority: issue.priority, assigneeId: issue.assigneeId },
  });
  return 'issue';
}

async function recordRun(
  db: Database | Tx,
  rule: Rule,
  job: AutomationJob,
  outcome: string,
  note: string | null,
) {
  const inserted = await db
    .insert(automationRuns)
    .values({
      ruleId: rule.id,
      workspaceId: rule.workspaceId,
      eventId: job.eventId,
      depth: job.depth,
      outcome,
      note,
    })
    .onConflictDoNothing()
    .returning({ id: automationRuns.id });
  return inserted.length > 0;
}

async function runRule(db: Database, rule: Rule, event: Event, issue: Issue, job: AutomationJob) {
  const added =
    job.trigger === 'issue.label_added'
      ? ((JSON.parse(event.payload) as { added?: string[] }).added ?? [])
      : null;
  const held = holdBack(rule, event, job);
  const outcome =
    held ??
    (matches(rule.conditions as AutomationCondition[], issue, added)
      ? null
      : { outcome: 'unmatched', note: null });
  const actor: AuditActor = { id: rule.id, kind: 'rule', depth: job.depth, requestId: null };
  try {
    const changed = await db.transaction(async (tx) => {
      const fresh = await recordRun(
        tx,
        rule,
        job,
        outcome?.outcome ?? 'applied',
        outcome?.note ?? null,
      );
      if (!fresh || outcome) return null;
      return applyAction(tx, rule, issue, actor, job);
    });
    if (changed === 'issue') {
      await publishEvent(db, {
        type: 'issue.updated',
        workspaceId: rule.workspaceId,
        projectId: issue.projectId,
        issueId: issue.id,
        actorId: rule.id,
      });
    } else if (changed === 'comment') {
      await publishEvent(db, {
        type: 'comment.created',
        workspaceId: rule.workspaceId,
        issueId: issue.id,
        actorId: rule.id,
      });
    }
    if (changed && typeof changed === 'object') {
      await publishEvent(db, {
        type: 'message.created',
        workspaceId: rule.workspaceId,
        channelId: changed.channelId,
        messageId: changed.messageId,
        actorId: rule.id,
      });
    }
  } catch (error) {
    await recordRun(
      db,
      rule,
      job,
      'failed',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** Every listening rule's turn at one event. */
export async function evaluateAutomation(db: Database, job: AutomationJob): Promise<void> {
  const [event] = await db
    .select({
      id: auditEvents.id,
      entityId: auditEvents.entityId,
      actorId: auditEvents.actorId,
      actorKind: auditEvents.actorKind,
      payload: auditEvents.payload,
    })
    .from(auditEvents)
    .where(and(eq(auditEvents.id, job.eventId), eq(auditEvents.workspaceId, job.workspaceId)));
  if (!event) return;
  const rules = await db
    .select()
    .from(automationRules)
    .where(
      and(
        eq(automationRules.workspaceId, job.workspaceId),
        eq(automationRules.trigger, job.trigger),
        eq(automationRules.enabled, true),
      ),
    );
  const issue = await issueOf(db, job.workspaceId, event.entityId);
  if (!issue) return;
  for (const rule of rules) await runRule(db, rule, event, issue, job);
}
