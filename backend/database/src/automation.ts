import type { AUTOMATION_TRIGGERS } from '@robis/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Executor } from './index.ts';
import { enqueue } from './queue.ts';
import { automationRules } from './schema.ts';

/**
 * Automation rules (B9): the triggers, and the job that evaluates them.
 * Recording an audit event of a trigger's kind queues the job, in the same
 * transaction, but only when the workspace has an enabled rule listening:
 * most workspaces have none, and their writes pay one indexed lookup.
 */

/** The job, run by the API's own runner: only the API signs the trail. */
export const AUTOMATION_JOB = 'automation.evaluate';

/** A rule's outgoing webhook, sent by the worker, which may reach the internet. */
export const AUTOMATION_WEBHOOK_JOB = 'automation.webhook';

export type AutomationWebhookJob = {
  ruleId: string;
  workspaceId: string;
  eventId: string;
  trigger: string;
  issueId: string;
  issueKey: string;
};

export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export type AutomationJob = {
  eventId: string;
  workspaceId: string;
  trigger: AutomationTrigger;
  /** 0 for a person's change; one more than the rule's own, for a rule's. */
  depth: number;
};

/** The trigger an audit event fires, if any. */
export function triggerOf(eventType: string, payload: unknown): AutomationTrigger | null {
  if (eventType === 'issue.created' || eventType === 'issue.status_changed') return eventType;
  if (eventType !== 'issue.labels_changed') return null;
  const added = (payload as { added?: unknown } | null)?.added;
  return Array.isArray(added) && added.length > 0 ? 'issue.label_added' : null;
}

export async function queueAutomation(tx: Executor, job: AutomationJob): Promise<void> {
  const [listening] = await tx
    .select({ one: sql<number>`1` })
    .from(automationRules)
    .where(
      and(
        eq(automationRules.workspaceId, job.workspaceId),
        eq(automationRules.trigger, job.trigger),
        eq(automationRules.enabled, true),
      ),
    )
    .limit(1);
  if (listening) await enqueue(tx, AUTOMATION_JOB, job);
}
