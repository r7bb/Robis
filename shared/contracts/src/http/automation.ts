import { z } from 'zod';
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from '../domain.ts';
import { uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';

/**
 * Automation rules (B9): when something happens to an issue, and it
 * matches every condition, do one thing. Rules run on the job queue,
 * once per triggering change, as a recorded actor of their own; a rule
 * never acts on its own change, and a chain of rules stops at a fixed
 * depth with a note in the rule's runs. Administrators manage them.
 */

export const AUTOMATION_TRIGGERS = [
  'issue.created',
  'issue.status_changed',
  'issue.label_added',
] as const;
export const AUTOMATION_MAX_DEPTH = 3;
export const AUTOMATION_RULES_MAX = 50;
export const AUTOMATION_CONDITIONS_MAX = 5;

export const CONDITION_FIELDS = ['status', 'priority', 'assignee', 'label', 'title'] as const;
export const CONDITION_OPS = ['is', 'is_not', 'contains'] as const;

const condition = z.object({
  field: z.enum(CONDITION_FIELDS),
  op: z.enum(CONDITION_OPS),
  /** A status, a priority, a user id or `nobody`, a label's name, or words. */
  value: z.string().trim().min(1).max(200),
});

export const automationAction = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('set_status'), status: z.enum(ISSUE_STATUSES) }),
  z.object({ kind: z.literal('set_priority'), priority: z.enum(ISSUE_PRIORITIES) }),
  z.object({ kind: z.literal('assign'), userId: uuid.nullable() }),
  z.object({ kind: z.literal('comment'), body: z.string().trim().min(1).max(2000) }),
]);
export type AutomationAction = z.infer<typeof automationAction>;
export type AutomationCondition = z.infer<typeof condition>;

const ruleInput = z.object({
  name: z.string().trim().min(1).max(80),
  trigger: z.enum(AUTOMATION_TRIGGERS),
  conditions: z.array(condition).max(AUTOMATION_CONDITIONS_MAX).default([]),
  action: automationAction,
  enabled: z.boolean().default(true),
});

const rule = z.object({
  id: uuid,
  name: z.string(),
  trigger: z.enum(AUTOMATION_TRIGGERS),
  conditions: z.array(condition),
  action: automationAction,
  enabled: z.boolean(),
  createdAt: timestamp,
  /** The last thirty days' runs by outcome. */
  runs: z.object({
    applied: z.number().int(),
    unmatched: z.number().int(),
    stopped: z.number().int(),
    failed: z.number().int(),
  }),
});

const run = z.object({
  eventId: uuid,
  depth: z.number().int(),
  outcome: z.enum(['applied', 'unmatched', 'own_change', 'stopped', 'failed']),
  note: z.string().nullable(),
  at: timestamp,
});

const ruleParams = workspaceParams.extend({ ruleId: z.string() });

export const automationContracts = {
  'automations.list': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/automations',
    summary: "The workspace's automation rules, with a month of their runs by outcome.",
    params: workspaceParams,
    response: z.object({ rules: z.array(rule) }),
  }),
  'automations.create': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/automations',
    summary: 'Add an automation rule: a trigger, conditions that must all hold, and one action.',
    params: workspaceParams,
    body: ruleInput,
    status: 201,
    response: z.object({ rule }),
  }),
  'automations.update': contract({
    method: 'PATCH',
    path: '/workspaces/:workspaceId/automations/:ruleId',
    summary: 'Change a rule, or turn it off or on.',
    params: ruleParams,
    body: ruleInput.partial(),
    response: z.object({ rule }),
  }),
  'automations.delete': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/automations/:ruleId',
    summary: 'Remove a rule; what it already did stays in the trail.',
    params: ruleParams,
    status: 204,
    response: null,
  }),
  'automations.runs': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/automations/:ruleId/runs',
    summary:
      "A rule's last fifty runs, newest first, with any note (a chain stopped, an action that failed).",
    params: ruleParams,
    response: z.object({ runs: z.array(run) }),
  }),
};
