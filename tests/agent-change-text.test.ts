import { describe, expect, test } from 'bun:test';
import { describeAgentChange, valueWords } from '@robis/web/lib/agent-change-text.ts';

const base = { agentName: 'Triage bot', entityType: 'issue' as const, issueKey: 'REL-4' };

describe('an agent’s change in plain words', () => {
  test('a field set from one value to another', () => {
    expect(describeAgentChange({ ...base, field: 'priority', before: 'NONE', after: 'HIGH' })).toBe(
      'Triage bot set the priority on REL-4 from none to high',
    );
    expect(
      describeAgentChange({ ...base, field: 'status', before: 'TODO', after: 'IN_PROGRESS' }),
    ).toBe('Triage bot set the status on REL-4 from Todo to In Progress');
  });

  test('long values are named, not shown', () => {
    expect(
      describeAgentChange({ ...base, field: 'description', before: null, after: 'Many words' }),
    ).toBe('Triage bot changed the description on REL-4');
  });

  test('a comment, a new issue, and an issue since deleted', () => {
    expect(
      describeAgentChange({
        ...base,
        entityType: 'comment',
        field: 'created',
        before: null,
        after: null,
      }),
    ).toBe('Triage bot commented on REL-4');
    expect(describeAgentChange({ ...base, field: 'created', before: null, after: null })).toBe(
      'Triage bot opened REL-4',
    );
    expect(
      describeAgentChange({
        ...base,
        issueKey: null,
        field: 'priority',
        before: 'LOW',
        after: 'HIGH',
      }),
    ).toBe('Triage bot set the priority on a deleted issue from low to high');
  });

  test('values read as people say them', () => {
    expect(valueWords('dueOn', null)).toBe('none');
    expect(valueWords('dueOn', '2026-11-20')).toBe('2026-11-20');
    expect(valueWords('title', 'Short')).toBe('“Short”');
    expect(valueWords('title', 'x'.repeat(80))?.length).toBeLessThanOrEqual(60);
  });
});
