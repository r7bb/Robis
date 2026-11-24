'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo } from 'react';
import { PriorityBadge } from '../../components/ui/badges.tsx';
import { call } from '../../lib/api.ts';
import { localToday } from '../../lib/due-date.ts';
import { dateFormat, formatClock } from '../../lib/i18n/format.ts';
import { issueHref } from '../../lib/links.ts';
import { describeNotification, notificationHref } from '../../lib/notification-text.ts';
import { todayWindow } from '../../lib/today.ts';
import { useMyId, usePeople } from '../../lib/use-people.ts';
import { dayLine, greeting, groupToday, type MyIssue } from './today-model.ts';

/**
 * Today: one calm list of what is yours to do, in this workspace. What is
 * overdue, due today and this week, today's meetings, what is in progress,
 * a few to pick up next, and the mentions waiting for you. Read-only: it
 * points to the work rather than holding it.
 */

const MENTIONS_SHOWN = 5;

function Group({
  title,
  tone,
  children,
  empty,
}: {
  title: string;
  tone?: 'urgent' | 'calm';
  children: React.ReactNode;
  empty?: boolean;
}) {
  if (empty) return null;
  return (
    <section
      aria-label={title}
      className={`rounded-xl border bg-raised p-4 shadow-sm ${tone === 'urgent' ? 'border-rose-400/40' : 'border-line'}`}
    >
      <h2
        className={`text-xs font-semibold uppercase tracking-wide ${tone === 'urgent' ? 'text-rose-300' : 'text-faint'}`}
      >
        {title}
      </h2>
      <ul className="mt-2 divide-y divide-line">{children}</ul>
    </section>
  );
}

function IssueRow({ workspaceId, issue }: { workspaceId: string; issue: MyIssue }) {
  return (
    <li>
      <Link
        href={issueHref(workspaceId, issue.id)}
        className="flex items-center gap-3 rounded-md py-2 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
      >
        <span className="w-16 shrink-0 font-mono text-xs text-faint">{issue.key}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-content">{issue.title}</span>
        <span className="hidden shrink-0 text-xs text-faint sm:inline">{issue.projectName}</span>
        {issue.priority === 'HIGH' || issue.priority === 'URGENT' ? (
          <PriorityBadge priority={issue.priority} />
        ) : null}
      </Link>
    </li>
  );
}

export function TodayView({ workspaceId }: { workspaceId: string }) {
  const me = useMyId();
  const { people } = usePeople(workspaceId);
  const today = localToday();
  const window = useMemo(() => {
    const { from, to } = todayWindow();
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);
  const mine = useQuery({
    queryKey: ['today', workspaceId],
    queryFn: () => call(contracts['today.mine'], { params: { workspaceId } }),
  });
  const meetings = useQuery({
    queryKey: ['meetings-mine', window.from],
    queryFn: () => call(contracts['meetings.mine'], { query: window }),
  });
  const mentions = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => call(contracts['notifications.list'], { query: { unread: '1' } }),
  });

  const groups = groupToday(mine.data?.issues ?? [], today);
  const todaysMeetings = (meetings.data?.meetings ?? []).filter(
    (m) => m.workspaceId === workspaceId,
  );
  const waiting = (mentions.data?.notifications ?? [])
    .filter((n) => n.workspaceId === workspaceId)
    .slice(0, MENTIONS_SHOWN);
  const name = me ? people.get(me)?.name.split(' ')[0] : undefined;
  const nothing =
    mine.isSuccess &&
    Object.values(groups).every((g) => g.length === 0) &&
    todaysMeetings.length === 0 &&
    waiting.length === 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <p className="text-sm text-faint">
        {dateFormat({ weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}
      </p>
      <h1 className="mt-1 text-balance text-2xl font-semibold tracking-tight text-content">
        {greeting(new Date().getHours())}
        {name ? `, ${name}` : ''}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {mine.isSuccess ? dayLine(groups, todaysMeetings.length) : 'Gathering your day…'}
      </p>

      {nothing ? (
        <div className="mt-8 rounded-xl border border-dashed border-line p-8 text-center">
          <p className="text-sm font-medium text-content">Nothing on your plate here</p>
          <p className="mx-auto mt-1 max-w-[44ch] text-sm text-muted">
            Pick something up from a board, or take the quiet hour for what usually waits.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4">
          <Group title="Overdue" tone="urgent" empty={groups.overdue.length === 0}>
            {groups.overdue.map((issue) => (
              <IssueRow key={issue.id} workspaceId={workspaceId} issue={issue} />
            ))}
          </Group>
          <Group title="Due today" empty={groups.today.length === 0}>
            {groups.today.map((issue) => (
              <IssueRow key={issue.id} workspaceId={workspaceId} issue={issue} />
            ))}
          </Group>
          <Group title="Meetings today" empty={todaysMeetings.length === 0}>
            {todaysMeetings.map((meeting) => (
              <li key={meeting.id} className="flex items-center gap-3 py-2">
                <span className="w-16 shrink-0 text-xs tabular-nums text-faint">
                  {formatClock(meeting.startsAt)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-content">
                  {meeting.title}
                </span>
                {meeting.joinUrl ? (
                  <a
                    href={meeting.joinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded-full border border-line px-2.5 py-0.5 text-xs text-muted hover:text-content"
                  >
                    Join
                  </a>
                ) : null}
              </li>
            ))}
          </Group>
          <Group title="This week" empty={groups.week.length === 0}>
            {groups.week.map((issue) => (
              <IssueRow key={issue.id} workspaceId={workspaceId} issue={issue} />
            ))}
          </Group>
          <Group title="In progress" empty={groups.working.length === 0}>
            {groups.working.map((issue) => (
              <IssueRow key={issue.id} workspaceId={workspaceId} issue={issue} />
            ))}
          </Group>
          <Group title="Waiting for you" empty={waiting.length === 0}>
            {waiting.map((item) => {
              const { actor, did, subject } = describeNotification(item);
              return (
                <li key={item.id}>
                  <Link
                    href={notificationHref(item)}
                    className="block truncate rounded-md py-2 text-sm text-muted transition-colors hover:bg-surface hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
                  >
                    <span className="text-content">{actor}</span> {did}
                    {subject ? <span className="text-content"> {subject}</span> : null}
                  </Link>
                </li>
              );
            })}
          </Group>
          <Group title="Up next" tone="calm" empty={groups.next.length === 0}>
            {groups.next.map((issue) => (
              <IssueRow key={issue.id} workspaceId={workspaceId} issue={issue} />
            ))}
          </Group>
        </div>
      )}
    </div>
  );
}
