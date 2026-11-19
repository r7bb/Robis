'use client';

import { contracts, type ResponseOf } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { call } from '../../lib/api.ts';
import { meetingState, todayWindow } from '../../lib/today.ts';
import { CardLoading, HomeCard } from './home-card.tsx';

/** A meeting someone else moved shows here within this long. */
const STALE_MS = 5 * 60_000;
/** How often "now" moves on, so a meeting under way is marked as one. */
const TICK_MS = 60_000;

const RESPONSE_WORD = { yes: 'Going', no: 'Not going', maybe: 'Maybe', pending: 'Not answered' };

/**
 * Today's meetings in every workspace you are in, soonest first, each with
 * its time, workspace and your answer; the join link appears shortly before
 * it starts. Meetings already over today drop off.
 */
export function TodayMeetings() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  // The whole of today, asked for once (and again at midnight, as the key
  // moves on); what is over is hidden here, as the minutes pass.
  const { from, to } = todayWindow(now);
  const meetings = useQuery({
    queryKey: ['my-meetings', from.toISOString(), to.toISOString()],
    queryFn: () =>
      call(contracts['meetings.mine'], {
        query: { from: from.toISOString(), to: to.toISOString() },
      }),
    staleTime: STALE_MS,
  });
  const rows = (meetings.data?.meetings ?? []).filter(
    (meeting) => meetingState(new Date(meeting.startsAt), meeting.durationMinutes, now) !== 'over',
  );

  return (
    <HomeCard id="home-meetings" title="Today’s meetings">
      {meetings.isPending ? (
        <CardLoading />
      ) : meetings.isError ? (
        <p className="text-sm text-faint">Today’s meetings could not be loaded.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-faint">Nothing else on today.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((meeting) => (
            <MeetingRow key={meeting.id} meeting={meeting} now={now} />
          ))}
        </ul>
      )}
    </HomeCard>
  );
}

type Meeting = ResponseOf<(typeof contracts)['meetings.mine']>['meetings'][number];

/** One meeting: its time, title, workspace and answer, and Join near the time. */
function MeetingRow({ meeting, now }: { meeting: Meeting; now: Date }) {
  const startsAt = new Date(meeting.startsAt);
  const state = meetingState(startsAt, meeting.durationMinutes, now);
  return (
    <li className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm">
      <time
        dateTime={startsAt.toISOString()}
        className={`w-12 shrink-0 font-mono text-xs ${state === 'now' ? 'text-accent-soft' : 'text-faint'}`}
      >
        {startsAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </time>
      <Link
        href={`/workspaces/${meeting.workspaceId}/meetings`}
        className="min-w-0 flex-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <span className="block truncate text-content hover:underline">{meeting.title}</span>
        <span className="block truncate text-xs text-faint">
          {meeting.workspaceName}, {meeting.durationMinutes} min,{' '}
          {RESPONSE_WORD[meeting.myResponse].toLowerCase()}
          {state === 'now' ? ', under way' : ''}
        </span>
      </Link>
      {meeting.joinUrl && state !== 'later' ? (
        <a
          href={meeting.joinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-contrast transition hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          Join
        </a>
      ) : null}
    </li>
  );
}
