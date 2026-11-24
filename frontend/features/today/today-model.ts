import type { contracts, ResponseOf } from '@robis/shared';

/**
 * Today's groups, pure so they are tested without a browser: what is
 * overdue, due today, due this week, in progress with no day, and the next
 * few to pick up. Each issue appears once, in the first group it fits.
 */

export type MyIssue = ResponseOf<(typeof contracts)['today.mine']>['issues'][number];

export type TodayGroups = {
  overdue: MyIssue[];
  today: MyIssue[];
  week: MyIssue[];
  working: MyIssue[];
  next: MyIssue[];
};

/** Issues shown under Up next: a few, not the backlog. */
export const NEXT_SHOWN = 5;
const WEEK_DAYS = 7;

/** `day` plus `days`, both YYYY-MM-DD. */
export function addDaysTo(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function groupToday(issues: readonly MyIssue[], today: string): TodayGroups {
  const weekEnd = addDaysTo(today, WEEK_DAYS);
  const groups: TodayGroups = { overdue: [], today: [], week: [], working: [], next: [] };
  for (const issue of issues) {
    if (issue.dueOn && issue.dueOn < today) groups.overdue.push(issue);
    else if (issue.dueOn === today) groups.today.push(issue);
    else if (issue.dueOn && issue.dueOn <= weekEnd) groups.week.push(issue);
    else if (issue.status === 'IN_PROGRESS' || issue.status === 'IN_REVIEW')
      groups.working.push(issue);
    else if (groups.next.length < NEXT_SHOWN) groups.next.push(issue);
  }
  return groups;
}

/** "Good morning", "Good afternoon" or "Good evening", by the viewer's clock. */
export function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** One line on the day, counting what needs doing. */
export function dayLine(groups: TodayGroups, meetings: number): string {
  const parts = [
    groups.overdue.length ? `${groups.overdue.length} overdue` : '',
    groups.today.length ? `${groups.today.length} due today` : '',
    meetings ? `${meetings} ${meetings === 1 ? 'meeting' : 'meetings'}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Nothing due today. A good day to get ahead.';
}
