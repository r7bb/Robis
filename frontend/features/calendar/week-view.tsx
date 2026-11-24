'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { call } from '../../lib/api.ts';
import { useT } from '../../lib/i18n/locale-context.tsx';
import {
  type Day,
  dateKey,
  dayLabel,
  isoWeek,
  isWeekend,
  placeOn,
  sameDay,
  shiftWeeks,
  wallToday,
  weekdayLabel,
  weekOf,
  weekTitle,
} from './week-model.ts';
import {
  DAY_PX,
  DayColumn,
  DueStrip,
  HourRail,
  type Occurrence,
  time,
  toneOf,
} from './week-parts.tsx';

/**
 * The week (B8): the workspace's meetings laid out in your own time zone,
 * repeats included, and the issues due each day along the top. A grid on
 * a wide screen; a list of days on a phone. Today is marked, and a line
 * shows the time now.
 */

/** The working day starts here, so the grid opens scrolled to it. */
const FIRST_HOUR_SHOWN = 7;
const MINUTE_MS = 60_000;
const shortDay = weekdayLabel;

/** The time now, ticking once a minute so the line for now moves. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), MINUTE_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const Chevron = ({ back }: { back?: boolean }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5" fill="none">
    <path
      d={back ? 'M10 3 5 8l5 5' : 'm6 3 5 5-5 5'}
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

function DayHeading({ day, today }: { day: Day; today: boolean }) {
  const { t } = useT();
  return (
    <p className="flex items-baseline gap-1.5 px-2 pb-1 pt-2">
      <span
        className={`text-[11px] font-medium uppercase tracking-wide ${today ? 'text-accent-soft' : isWeekend(day) ? 'text-faint' : 'text-muted'}`}
      >
        {shortDay(day)}
      </span>
      <span
        className={`grid h-7 min-w-7 place-items-center rounded-full px-1 text-base font-semibold tabular-nums ${today ? 'bg-accent text-accent-contrast' : 'text-content'}`}
      >
        {day.day}
      </span>
      {today ? <span className="sr-only">{t('calendar.today')}</span> : null}
    </p>
  );
}

function PhoneList({
  days,
  today,
  meetingsOn,
  dueOn,
}: {
  days: Day[];
  today: Day;
  meetingsOn: (day: Day) => Occurrence[];
  dueOn: (day: Day) => { id: string; key: string; title: string }[];
}) {
  const { t } = useT();
  return (
    <ol className="space-y-2.5 sm:hidden">
      {days.map((day) => {
        const isToday = sameDay(day, today);
        const meetings = meetingsOn(day);
        const due = dueOn(day);
        return (
          <li
            key={dateKey(day)}
            className={`flex gap-3 rounded-xl border p-3 ${isToday ? 'border-accent-soft/50 bg-accent/[0.06]' : 'border-line bg-raised'}`}
          >
            <div className="w-10 shrink-0 text-center">
              <p
                className={`text-[10px] font-medium uppercase ${isToday ? 'text-accent-soft' : 'text-faint'}`}
              >
                {shortDay(day)}
              </p>
              <p className="text-xl font-semibold tabular-nums text-content">{day.day}</p>
            </div>
            <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
              {meetings.map((m) => (
                <li
                  key={`${m.meetingId}-${m.week}`}
                  className="flex items-center gap-2 text-content"
                >
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 shrink-0 rounded-full ${toneOf(m).dot}`}
                  />
                  <span className="tabular-nums text-faint">
                    {time.format(new Date(m.startsAt))}
                  </span>
                  <span className="truncate">{m.title}</span>
                </li>
              ))}
              {due.map((issue) => (
                <li key={issue.id} className="truncate text-muted">
                  {t('calendar.dueItem')} <span className="font-mono text-faint">{issue.key}</span>{' '}
                  {issue.title}
                </li>
              ))}
              {meetings.length + due.length === 0 ? (
                <li className="text-faint">{t('calendar.nothing')}</li>
              ) : null}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}

export function WeekView({ workspaceId }: { workspaceId: string }) {
  const { t, plural } = useT();
  const zone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const now = useNow();
  const today = wallToday(now, zone);
  const grid = useRef<HTMLElement>(null);
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
  const onThisWeek = week.days.some((day) => sameDay(day, today));
  const step =
    'grid h-8 place-items-center rounded-md px-2.5 text-xs font-medium text-muted transition hover:bg-surface hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft';

  return (
    <section aria-label={t('calendar.weekOf', { date: dayLabel(week.days[0]!) })}>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h2 className="text-2xl font-semibold tracking-tight text-content">
            {weekTitle(week.days, (start, end) => t('calendar.span', { start, end }))}
          </h2>
          <p className="mt-0.5 text-xs text-faint">
            {[
              t('calendar.week', { number: isoWeek(week.days[0]!) }),
              plural('calendar.meetings', meetings.length),
              plural('calendar.due', issues.length),
              t('calendar.zone', { zone: zone.replace(/_/g, ' ') }),
            ].join(' · ')}
          </p>
        </div>
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-raised p-0.5 shadow-sm">
          <button
            type="button"
            className={step}
            aria-label={t('calendar.previous')}
            onClick={() => setAnchor(shiftWeeks(anchor, -1))}
          >
            <Chevron back />
          </button>
          <button
            type="button"
            className={`${step} ${onThisWeek ? 'text-content' : ''}`}
            aria-pressed={onThisWeek}
            onClick={() => setAnchor(new Date())}
          >
            {t('calendar.thisWeek')}
          </button>
          <button
            type="button"
            className={step}
            aria-label={t('calendar.next')}
            onClick={() => setAnchor(shiftWeeks(anchor, 1))}
          >
            <Chevron />
          </button>
        </div>
      </div>
      {data.isError ? (
        <p role="alert" className="mb-3 text-sm text-muted">
          {t('calendar.unloaded')}
        </p>
      ) : null}

      <PhoneList days={week.days} today={today} meetingsOn={meetingsOn} dueOn={dueOn} />

      {/* Wider screens: the grid. */}
      <div className="hidden overflow-hidden rounded-xl border border-line bg-surface shadow-sm sm:block">
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-line bg-raised">
          <div />
          {week.days.map((day) => (
            <div
              key={dateKey(day)}
              className={`border-l border-line ${sameDay(day, today) ? 'bg-accent/[0.06]' : ''}`}
            >
              <DayHeading day={day} today={sameDay(day, today)} />
              <DueStrip workspaceId={workspaceId} issues={dueOn(day)} />
            </div>
          ))}
        </div>
        {/* Reachable by Tab, so the hours can be scrolled from the keyboard (C9). */}
        <section
          ref={grid}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable area must take focus to be scrolled without a mouse (WCAG 2.1.1)
          tabIndex={0}
          aria-label={t('calendar.hours')}
          className="max-h-[36rem] overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-soft"
        >
          <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
            <HourRail />
            {week.days.map((day) => (
              <DayColumn
                key={dateKey(day)}
                day={day}
                zone={zone}
                meetings={meetingsOn(day)}
                now={now}
                isToday={sameDay(day, today)}
              />
            ))}
          </div>
        </section>
        {meetings.length === 0 && data.isSuccess ? (
          <p className="border-t border-line px-4 py-2.5 text-xs text-faint">
            {t('calendar.noMeetings')}
          </p>
        ) : null}
      </div>
    </section>
  );
}
