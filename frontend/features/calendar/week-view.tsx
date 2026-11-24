'use client';

import { contracts, type ResponseOf } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { call } from '../../lib/api.ts';
import {
  type Day,
  dateKey,
  dayLabel,
  hourAt,
  lanes,
  placeOn,
  shiftWeeks,
  weekOf,
} from './week-model.ts';

/**
 * The week (B8): the workspace's meetings laid out in your own time zone,
 * repeats included, and the issues due each day along the top. A grid on
 * a wide screen; a list of days on a phone.
 */

type Week = ResponseOf<(typeof contracts)['calendar.week']>;
type Occurrence = Week['meetings'][number];

const HOURS = [0, 3, 6, 9, 12, 15, 18, 21];
/** The grid's height for a whole day, in pixels: an hour is 40. */
const DAY_PX = 24 * 40;
/** The working day starts here, so the grid opens scrolled to it. */
const FIRST_HOUR_SHOWN = 7;
const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

const tone = (meeting: Occurrence) =>
  meeting.myResponse === null
    ? 'border-line bg-surface text-muted'
    : meeting.myResponse === 'pending'
      ? 'border-dashed border-accent-soft/60 bg-raised text-content'
      : 'border-accent-soft/50 bg-accent/15 text-content';

function DayColumn({ day, zone, meetings }: { day: Day; zone: string; meetings: Occurrence[] }) {
  const placed = meetings
    .map((meeting) => ({
      meeting,
      at: placeOn(day, new Date(meeting.startsAt), meeting.durationMinutes, zone),
    }))
    .filter(
      (item): item is { meeting: Occurrence; at: { top: number; height: number } } =>
        item.at !== null,
    );
  const laid = lanes(placed.map(({ at }) => ({ start: at.top, end: at.top + at.height })));
  return (
    <div className="relative border-l border-line" style={{ height: DAY_PX }}>
      {HOURS.map((hour) => (
        <div
          key={hour}
          className="absolute inset-x-0 border-t border-line/50"
          style={{ top: `${hourAt(day, hour, zone) * 100}%` }}
        />
      ))}
      {placed.map(({ meeting, at }, i) => (
        <div
          key={`${meeting.meetingId}-${meeting.week}`}
          className={`absolute overflow-hidden rounded-md border px-1.5 py-1 text-[11px] leading-tight ${tone(meeting)}`}
          style={{
            top: `${at.top * 100}%`,
            height: `max(${at.height * 100}%, 1.25rem)`,
            left: `${(laid[i]!.lane / laid[i]!.lanes) * 100}%`,
            width: `${100 / laid[i]!.lanes}%`,
          }}
        >
          <p className="truncate font-medium">{meeting.title}</p>
          <p className="truncate text-faint">{time.format(new Date(meeting.startsAt))}</p>
        </div>
      ))}
    </div>
  );
}

function DueStrip({ workspaceId, issues }: { workspaceId: string; issues: Week['issues'] }) {
  if (issues.length === 0) return <div className="min-h-6" />;
  return (
    <ul className="space-y-1 px-1 pb-1">
      {issues.map((issue) => (
        <li key={issue.id}>
          <Link
            href={`/workspaces/${workspaceId}/issues/${issue.id}`}
            className={`block truncate rounded border border-line bg-raised px-1.5 py-0.5 text-[11px] text-content hover:border-accent-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${issue.status === 'DONE' ? 'line-through opacity-60' : ''}`}
          >
            <span className="font-mono text-faint">{issue.key}</span> {issue.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function WeekView({ workspaceId }: { workspaceId: string }) {
  const zone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (grid.current) grid.current.scrollTop = (DAY_PX * FIRST_HOUR_SHOWN) / 24;
  }, []);
  const [anchor, setAnchor] = useState(() => new Date());
  const week = useMemo(() => weekOf(anchor, zone), [anchor, zone]);
  const data = useQuery({
    queryKey: ['calendar-week', workspaceId, week.firstDay, zone],
    queryFn: () =>
      call(contracts['calendar.week'], {
        params: { workspaceId },
        query: {
          from: week.from.toISOString(),
          to: week.to.toISOString(),
          firstDay: week.firstDay,
          lastDay: week.lastDay,
        },
      }),
  });
  const meetings = data.data?.meetings ?? [];
  const issues = data.data?.issues ?? [];
  const dueOn = (day: Day) => issues.filter((issue) => issue.dueOn === dateKey(day));
  const meetingsOn = (day: Day) =>
    meetings.filter((m) => placeOn(day, new Date(m.startsAt), m.durationMinutes, zone));
  const button =
    'rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:bg-surface hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft';

  return (
    <section aria-label={`Week of ${dayLabel(week.days[0]!)}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted">
          {dayLabel(week.days[0]!)} to {dayLabel(week.days[6]!)} · times in{' '}
          {zone.replace(/_/g, ' ')}
        </p>
        <button type="button" className={button} onClick={() => setAnchor(shiftWeeks(anchor, -1))}>
          Previous week
        </button>
        <button type="button" className={button} onClick={() => setAnchor(new Date())}>
          This week
        </button>
        <button type="button" className={button} onClick={() => setAnchor(shiftWeeks(anchor, 1))}>
          Next week
        </button>
      </div>
      {data.isError ? (
        <p role="alert" className="text-sm text-muted">
          The week could not be loaded. Try again in a moment.
        </p>
      ) : null}

      {/* Phones: a list of the days. */}
      <ol className="space-y-3 sm:hidden">
        {week.days.map((day) => (
          <li key={dateKey(day)} className="rounded-lg border border-line bg-raised p-3">
            <h3 className="text-xs font-semibold text-content">{dayLabel(day)}</h3>
            <ul className="mt-1.5 space-y-1 text-sm">
              {meetingsOn(day).map((m) => (
                <li key={`${m.meetingId}-${m.week}`} className="text-content">
                  <span className="tabular-nums text-faint">
                    {time.format(new Date(m.startsAt))}
                  </span>{' '}
                  {m.title}
                </li>
              ))}
              {dueOn(day).map((issue) => (
                <li key={issue.id} className="text-muted">
                  Due: {issue.key} {issue.title}
                </li>
              ))}
              {meetingsOn(day).length + dueOn(day).length === 0 ? (
                <li className="text-faint">Nothing</li>
              ) : null}
            </ul>
          </li>
        ))}
      </ol>

      {/* Wider screens: the grid. */}
      <div className="hidden overflow-hidden rounded-lg border border-line sm:block">
        <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))] border-b border-line bg-raised">
          <div />
          {week.days.map((day) => (
            <div key={dateKey(day)} className="border-l border-line">
              <p className="px-1.5 py-1.5 text-[11px] font-semibold text-content">
                {dayLabel(day)}
              </p>
              <DueStrip workspaceId={workspaceId} issues={dueOn(day)} />
            </div>
          ))}
        </div>
        {/* Reachable by Tab, so the hours can be scrolled from the keyboard (C9). */}
        <section
          ref={grid}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable area must take focus to be scrolled without a mouse (WCAG 2.1.1)
          tabIndex={0}
          aria-label="The week, hour by hour"
          className="max-h-[32rem] overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
        >
          <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))]">
            <div className="relative" style={{ height: DAY_PX }} aria-hidden="true">
              {HOURS.map((hour) => (
                <span
                  key={hour}
                  className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-faint"
                  style={{ top: `${(hour / 24) * 100}%` }}
                >
                  {String(hour).padStart(2, '0')}:00
                </span>
              ))}
            </div>
            {week.days.map((day) => (
              <DayColumn key={dateKey(day)} day={day} zone={zone} meetings={meetingsOn(day)} />
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
