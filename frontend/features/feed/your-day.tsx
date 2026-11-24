'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { PriorityBadge } from '../../components/ui/badges.tsx';
import { call } from '../../lib/api.ts';
import { localToday } from '../../lib/due-date.ts';
import { issueHref } from '../../lib/links.ts';
import { groupToday, type MyIssue } from '../today/today-model.ts';

/**
 * Your day, at the top of the feed: what is overdue and due today for you
 * in this workspace, with a word on the rest of the week. The home shows
 * the same across every workspace; this keeps the feed's own place in view
 * while you read it. Nothing shows when nothing is due.
 */

const SHOWN = 4;

function Row({ workspaceId, issue, late }: { workspaceId: string; issue: MyIssue; late: boolean }) {
  return (
    <li>
      <Link
        href={issueHref(workspaceId, issue.id)}
        className="flex items-center gap-3 rounded-md px-1 py-1.5 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
      >
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${late ? 'bg-rose-500/15 text-rose-300' : 'bg-accent/15 text-accent-soft'}`}
        >
          {late ? 'Overdue' : 'Today'}
        </span>
        <span className="w-14 shrink-0 font-mono text-xs text-faint">{issue.key}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-content">{issue.title}</span>
        {issue.priority === 'HIGH' || issue.priority === 'URGENT' ? (
          <PriorityBadge priority={issue.priority} />
        ) : null}
      </Link>
    </li>
  );
}

export function YourDay({ workspaceId }: { workspaceId: string }) {
  const mine = useQuery({
    queryKey: ['today', workspaceId],
    queryFn: () => call(contracts['today.mine'], { params: { workspaceId } }),
  });
  const groups = groupToday(mine.data?.issues ?? [], localToday());
  const due = [
    ...groups.overdue.map((issue) => ({ issue, late: true })),
    ...groups.today.map((issue) => ({ issue, late: false })),
  ];
  if (due.length === 0 && groups.week.length === 0) return null;
  const later = groups.week.length;

  return (
    <section
      aria-labelledby="your-day-heading"
      className="mt-4 rounded-xl border border-line bg-raised px-4 py-3"
    >
      <h2
        id="your-day-heading"
        className="text-xs font-semibold uppercase tracking-wide text-faint"
      >
        Your day
      </h2>
      {due.length > 0 ? (
        <ul className="mt-1.5">
          {due.slice(0, SHOWN).map(({ issue, late }) => (
            <Row key={issue.id} workspaceId={workspaceId} issue={issue} late={late} />
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-sm text-muted">Nothing due today.</p>
      )}
      <p className="mt-1.5 text-xs text-faint">
        {due.length > SHOWN ? `${due.length - SHOWN} more due now. ` : ''}
        {later > 0 ? `${later} more due this week.` : 'Nothing else due this week.'}
      </p>
    </section>
  );
}
