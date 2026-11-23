import { describe, expect, test } from 'bun:test';
import { actionLabel, ruleSentence, runsLine } from '@robis/web/features/automations/rule-model.ts';

/** What the rules page says (B9): each rule as one sentence, and a month of its runs. */

const nameOf = (id: string) => (id === 'u1' ? 'Ada' : 'someone');

describe('a rule in words', () => {
  test('when, if, then', () => {
    expect(
      ruleSentence(
        {
          trigger: 'issue.created',
          conditions: [{ field: 'priority', op: 'is', value: 'URGENT' }],
          action: { kind: 'assign', userId: 'u1' },
        },
        nameOf,
      ),
    ).toBe('When an issue is filed and its priority is urgent, assign it to Ada.');
    expect(
      ruleSentence(
        {
          trigger: 'issue.label_added',
          conditions: [{ field: 'label', op: 'is', value: 'bug' }],
          action: { kind: 'set_status', status: 'IN_PROGRESS' },
        },
        nameOf,
      ),
    ).toBe(
      'When a label is added to an issue and its label is “bug”, set the status to in progress.',
    );
  });

  test('every action has words, a webhook naming only its host', () => {
    expect(actionLabel({ kind: 'webhook', url: 'https://hooks.example.com/a/b?c=1' }, nameOf)).toBe(
      'send a webhook to hooks.example.com',
    );
    expect(actionLabel({ kind: 'notify', who: 'reporter', message: 'x' }, nameOf)).toBe(
      'tell its reporter',
    );
    expect(actionLabel({ kind: 'assign', userId: null }, nameOf)).toBe('leave it unassigned');
  });

  test('a month of runs, or nothing when it has not run', () => {
    expect(runsLine({ applied: 3, unmatched: 1, stopped: 0, failed: 0 })).toBe(
      'Last 30 days: acted 3 times, 1 not matched.',
    );
    expect(runsLine({ applied: 0, unmatched: 0, stopped: 0, failed: 0 })).toBeNull();
  });
});
