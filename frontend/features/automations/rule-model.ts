import type { AutomationAction, AutomationCondition, contracts, ResponseOf } from '@robis/shared';

/**
 * Automation rules as the rules page words them (B9): pure, so each
 * sentence is tested without a browser. A rule reads as one sentence:
 * when this happens, if these hold, do that.
 */

export type Rule = ResponseOf<(typeof contracts)['automations.list']>['rules'][number];

export const TRIGGER_LABELS: Record<Rule['trigger'], string> = {
  'issue.created': 'an issue is filed',
  'issue.status_changed': 'an issue changes status',
  'issue.label_added': 'a label is added to an issue',
};

const FIELD_LABELS: Record<AutomationCondition['field'], string> = {
  status: 'status',
  priority: 'priority',
  assignee: 'assignee',
  label: 'label',
  title: 'title',
};

const OP_LABELS: Record<AutomationCondition['op'], string> = {
  is: 'is',
  is_not: 'is not',
  contains: 'contains',
};

const words = (value: string) => value.toLowerCase().replace(/_/g, ' ');

/** One condition, in words: "priority is urgent". */
function conditionLabel(condition: AutomationCondition, nameOf: (id: string) => string): string {
  const value =
    condition.field === 'assignee'
      ? condition.value === 'nobody'
        ? 'nobody'
        : nameOf(condition.value)
      : condition.field === 'label' || condition.field === 'title'
        ? `“${condition.value}”`
        : words(condition.value);
  return `${FIELD_LABELS[condition.field]} ${OP_LABELS[condition.op]} ${value}`;
}

/** The action, in words: "set the status to done". */
export function actionLabel(action: AutomationAction, nameOf: (id: string) => string): string {
  switch (action.kind) {
    case 'set_status':
      return `set the status to ${words(action.status)}`;
    case 'set_priority':
      return `set the priority to ${words(action.priority)}`;
    case 'assign':
      return action.userId ? `assign it to ${nameOf(action.userId)}` : 'leave it unassigned';
    case 'comment':
      return 'comment on it';
    case 'notify':
      return `tell its ${action.who}`;
    case 'post_to_channel':
      return 'post in a channel';
    case 'webhook':
      return `send a webhook to ${new URL(action.url).host}`;
  }
}

/** The whole rule as one sentence. */
export function ruleSentence(
  rule: Pick<Rule, 'trigger' | 'conditions' | 'action'>,
  nameOf: (id: string) => string,
): string {
  const when = `When ${TRIGGER_LABELS[rule.trigger]}`;
  const conditions = rule.conditions.map((condition) => conditionLabel(condition, nameOf));
  const ifPart = conditions.length > 0 ? ` and its ${conditions.join(' and ')}` : '';
  return `${when}${ifPart}, ${actionLabel(rule.action, nameOf)}.`;
}

/** A month of what the rule did, in words; null when it has not run. */
export function runsLine(runs: Rule['runs']): string | null {
  const parts = [
    runs.applied ? `acted ${runs.applied} ${runs.applied === 1 ? 'time' : 'times'}` : null,
    runs.unmatched ? `${runs.unmatched} not matched` : null,
    runs.stopped ? `${runs.stopped} stopped in a chain` : null,
    runs.failed ? `${runs.failed} failed` : null,
  ].filter((part) => part !== null);
  return parts.length === 0 ? null : `Last 30 days: ${parts.join(', ')}.`;
}
