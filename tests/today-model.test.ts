import { describe, expect, test } from 'bun:test';
import {
  addDaysTo,
  groupToday,
  type MyIssue,
  NEXT_SHOWN,
} from '@robis/web/features/today/today-model.ts';

/** Today's groups: each issue once, in the first group it fits. */

const issue = (key: string, fields: Partial<MyIssue> = {}): MyIssue => ({
  id: key,
  key,
  title: key,
  status: 'TODO',
  priority: 'NONE',
  dueOn: null,
  projectId: '00000000-0000-4000-8000-000000000001',
  projectName: 'Backend',
  ...fields,
});

describe('the day', () => {
  test('sorts overdue, due today, this week, in progress and a few next', () => {
    const today = '2026-11-24';
    const groups = groupToday(
      [
        issue('A-1', { dueOn: '2026-11-20' }),
        issue('A-2', { dueOn: today }),
        issue('A-3', { dueOn: '2026-11-30' }),
        issue('A-4', { dueOn: '2026-12-20' }),
        issue('A-5', { status: 'IN_REVIEW' }),
        ...Array.from({ length: NEXT_SHOWN + 2 }, (_, i) => issue(`B-${i}`)),
      ],
      today,
    );
    expect(groups.overdue.map((i) => i.key)).toEqual(['A-1']);
    expect(groups.today.map((i) => i.key)).toEqual(['A-2']);
    expect(groups.week.map((i) => i.key)).toEqual(['A-3']);
    expect(groups.working.map((i) => i.key)).toEqual(['A-5']);
    expect(groups.next).toHaveLength(NEXT_SHOWN);
    expect(groups.next[0]?.key).toBe('A-4');
  });

  test('counts the week across a year end', () => {
    expect(addDaysTo('2026-12-28', 7)).toBe('2027-01-04');
  });
});
