import { describe, expect, test } from 'bun:test';
import { describeDue, localToday } from '@robis/web/lib/due-date.ts';

/** How a due day reads on a card and an issue (C1). */

const TODAY = '2026-11-18';

describe('a due day', () => {
  test('reads relative while it is near', () => {
    expect(describeDue('2026-11-18', TODAY)).toEqual({ text: 'Due today', tone: 'soon' });
    expect(describeDue('2026-11-19', TODAY)).toEqual({ text: 'Due tomorrow', tone: 'soon' });
    expect(describeDue('2026-11-24', TODAY)).toEqual({ text: 'Due in 6 days', tone: 'soon' });
  });

  test('reads as a date once it is further off, across a month and a year', () => {
    expect(describeDue('2026-11-25', TODAY)).toEqual({ text: 'Due 25 Nov', tone: 'later' });
    expect(describeDue('2027-01-03', TODAY).text).toBe('Due 3 Jan');
  });

  test('says how late it is once passed', () => {
    expect(describeDue('2026-11-17', TODAY)).toEqual({ text: 'Overdue by 1 day', tone: 'overdue' });
    expect(describeDue('2026-10-31', TODAY).text).toBe('Overdue by 18 days');
  });

  test('finished work is never overdue', () => {
    expect(describeDue('2026-10-31', TODAY, true)).toEqual({ text: 'Due 31 Oct', tone: 'done' });
  });

  test('today is the viewer’s own calendar day', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});
