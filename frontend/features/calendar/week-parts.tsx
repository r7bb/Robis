'use client';

import type { contracts, ResponseOf } from '@robis/shared';
import Link from 'next/link';
import { formatClock } from '../../lib/i18n/format.ts';
import { useT } from '../../lib/i18n/locale-context.tsx';
import { type Day, hourAt, isWeekend, lanes, nowOn, placeOn, toneIndex } from './week-model.ts';

/**
 * The pieces of the week grid: a day's column of meetings with the line for
 * now, the issues due along the top, and the hours down the side. Each
 * meeting keeps one colour week after week, so a repeat is recognised at a
 * glance.
 */

type Week = ResponseOf<(typeof contracts)['calendar.week']>;
export type Occurrence = Week['meetings'][number];
export type DueIssue = Week['issues'][number];

/** The grid's height for a whole day, in pixels: an hour is 48. */
const HOUR_PX = 48;
export const DAY_PX = 24 * HOUR_PX;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** A time of day in the viewer's locale. */
export const time = { format: formatClock };

/** Meeting colours: a bar on the left and a wash behind, readable on every theme. */
const TONES = [
  { bar: 'bg-sky-400', wash: 'bg-sky-500/15', dot: 'bg-sky-400' },
  { bar: 'bg-emerald-400', wash: 'bg-emerald-500/15', dot: 'bg-emerald-400' },
  { bar: 'bg-amber-400', wash: 'bg-amber-500/15', dot: 'bg-amber-400' },
  { bar: 'bg-rose-400', wash: 'bg-rose-500/15', dot: 'bg-rose-400' },
  { bar: 'bg-violet-400', wash: 'bg-violet-500/15', dot: 'bg-violet-400' },
] as const;

export const toneOf = (meeting: Occurrence) => TONES[toneIndex(meeting.meetingId, TONES.length)]!;

/** Not invited reads quieter; still to answer reads dashed. */
function standing(meeting: Occurrence): string {
  if (meeting.myResponse === null) return 'opacity-70';
  if (meeting.myResponse === 'pending') return 'outline-dashed outline-1 outline-line';
  return '';
}

function MeetingBlock({
  meeting,
  at,
  lane,
}: {
  meeting: Occurrence;
  at: { top: number; height: number };
  lane: { lane: number; lanes: number };
}) {
  const { t } = useT();
  const tone = toneOf(meeting);
  const short = at.height * 24 < 0.75;
  const ends = new Date(new Date(meeting.startsAt).getTime() + meeting.durationMinutes * 60_000);
  return (
    <div
      title={`${meeting.title}, ${t('calendar.span', { start: time.format(new Date(meeting.startsAt)), end: time.format(ends) })}`}
      className={`absolute overflow-hidden rounded-md pl-2.5 pr-1.5 py-1 text-[11px] leading-tight text-content shadow-sm ring-1 ring-line/60 transition hover:z-10 hover:shadow-md ${tone.wash} ${standing(meeting)}`}
      style={{
        top: `calc(${at.top * 100}% + 1px)`,
        height: `max(calc(${at.height * 100}% - 2px), 1.25rem)`,
        left: `calc(${(lane.lane / lane.lanes) * 100}% + 2px)`,
        width: `calc(${100 / lane.lanes}% - 4px)`,
      }}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-1 left-1 w-[3px] rounded-full ${tone.bar}`}
      />
      <p className="truncate font-medium">{meeting.title}</p>
      {short ? null : (
        <p className="truncate tabular-nums text-muted">
          {t('calendar.span', {
            start: time.format(new Date(meeting.startsAt)),
            end: time.format(ends),
          })}
        </p>
      )}
    </div>
  );
}

export function DayColumn({
  day,
  zone,
  meetings,
  now,
  isToday,
}: {
  day: Day;
  zone: string;
  meetings: Occurrence[];
  now: Date;
  isToday: boolean;
}) {
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
  const nowAt = isToday ? nowOn(day, now, zone) : null;
  const shade = isToday ? 'bg-accent/[0.04]' : isWeekend(day) ? 'bg-raised/50' : '';
  return (
    <div className={`relative border-l border-line ${shade}`} style={{ height: DAY_PX }}>
      {HOURS.map((hour) => (
        <div
          key={hour}
          className={`absolute inset-x-0 border-t ${hour % 6 === 0 ? 'border-line' : 'border-line/40'}`}
          style={{ top: `${hourAt(day, hour, zone) * 100}%` }}
        />
      ))}
      {placed.map(({ meeting, at }, i) => (
        <MeetingBlock
          key={`${meeting.meetingId}-${meeting.week}`}
          meeting={meeting}
          at={at}
          lane={laid[i]!}
        />
      ))}
      {nowAt === null ? null : (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-rose-500"
          style={{ top: `${nowAt * 100}%` }}
        >
          <span className="absolute -left-[5px] -top-[6px] h-2.5 w-2.5 rounded-full bg-rose-500" />
        </div>
      )}
    </div>
  );
}

export function HourRail() {
  return (
    <div className="relative" style={{ height: DAY_PX }} aria-hidden="true">
      {HOURS.slice(1).map((hour) => (
        <span
          key={hour}
          className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-faint"
          style={{ top: `${(hour / 24) * 100}%` }}
        >
          {String(hour).padStart(2, '0')}:00
        </span>
      ))}
    </div>
  );
}

export function DueStrip({ workspaceId, issues }: { workspaceId: string; issues: DueIssue[] }) {
  if (issues.length === 0) return <div className="min-h-2" />;
  return (
    <ul className="space-y-1 px-1.5 pb-1.5">
      {issues.map((issue) => (
        <li key={issue.id}>
          <Link
            href={`/workspaces/${workspaceId}/issues/${issue.id}`}
            className={`flex items-center gap-1 truncate rounded-md bg-surface px-1.5 py-0.5 text-[11px] text-content ring-1 ring-line transition hover:ring-accent-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${issue.status === 'DONE' ? 'line-through opacity-60' : ''}`}
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            <span className="font-mono text-faint">{issue.key}</span>
            <span className="truncate">{issue.title}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
