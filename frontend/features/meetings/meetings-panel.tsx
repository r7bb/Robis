'use client';

import { can, type Role } from '@robis/shared';
import { useState } from 'react';
import { EmptyView } from '../../components/empty-view.tsx';
import { Button, InlineError, Pill } from '../../components/ui/primitives.tsx';
import { ApiError, type Member } from '../../lib/api.ts';
import { formatDay, formatTime, formatUntil } from '../../lib/time.ts';
import { useScrollToHash } from '../../lib/use-scroll-to-hash.ts';
import { DraftAgenda } from '../assist/draft-agenda.tsx';
import { ImportCalendar } from './import-calendar.tsx';
import { ScheduleDialog } from './schedule-dialog.tsx';
import type { Meeting, MeetingAnswer } from './types.ts';
import {
  countAccepted,
  responseOf,
  useCancelMeeting,
  useMeetings,
  useRespondToMeeting,
  useScheduleMeeting,
} from './use-meetings.ts';

const RESPONSES: { value: MeetingAnswer; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'no', label: 'No' },
];

function MeetingCard({
  workspaceId,
  meeting,
  currentUserId,
  canCancel,
  onRespond,
  onCancel,
}: {
  workspaceId?: string;
  meeting: Meeting;
  currentUserId: string | null;
  canCancel: boolean;
  onRespond: (response: MeetingAnswer) => void;
  onCancel: () => void;
}) {
  const mine = responseOf(meeting, currentUserId);
  const accepted = countAccepted(meeting);

  return (
    <article className="rounded-lg border border-line bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <h4 className="min-w-0 flex-1 truncate text-sm font-medium text-content">
          {meeting.title}
        </h4>
        <Pill tone="accent">{formatUntil(meeting.nextStartsAt)}</Pill>
      </div>

      <p className="mt-0.5 text-xs text-faint">
        {formatDay(meeting.nextStartsAt)} at {formatTime(meeting.nextStartsAt)} ·{' '}
        {meeting.durationMinutes} min
        {meeting.repeatCount ? ` · weekly, ${meeting.repeatCount} times` : ''}
      </p>

      {meeting.agenda ? (
        // Clamped rather than truncated to one line: an agenda is usually a
        // sentence or two, and the panel is narrow.
        <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap break-words text-xs text-muted">
          {meeting.agenda}
        </p>
      ) : null}

      <p className="mt-1.5 text-[10px] text-faint">
        {meeting.organizerName ? `${meeting.organizerName} · ` : ''}
        {accepted} of {meeting.attendees.length} going
      </p>
      {canCancel && workspaceId ? (
        <DraftAgenda workspaceId={workspaceId} meetingId={meeting.id} />
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {meeting.joinUrl ? (
          <a
            href={meeting.joinUrl}
            target="_blank"
            /*
             * `noopener` is the one that matters: without it the opened page
             * gets a handle on this one through `window.opener` and can
             * navigate it somewhere else. `noreferrer` keeps the workspace
             * URL -- which contains a workspace id -- out of the third party's
             * referer logs.
             */
            rel="noopener noreferrer"
            className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
          >
            Join
          </a>
        ) : null}

        {/* A real fieldset rather than a div with role="group": the native
            element carries the grouping semantics without an ARIA attribute
            that has to be kept correct by hand. */}
        <fieldset className="flex gap-px rounded-md border border-line p-px">
          <legend className="sr-only">Your response</legend>

          {RESPONSES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onRespond(option.value)}
              aria-pressed={mine === option.value}
              className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                mine === option.value
                  ? 'bg-accent/20 font-medium text-accent-soft'
                  : 'text-faint hover:text-content'
              }`}
            >
              {option.label}
            </button>
          ))}
        </fieldset>

        {canCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-faint transition-colors hover:text-danger-soft"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </article>
  );
}

/** What is coming up, and the button that adds to it. */
export function MeetingsPanel({
  workspaceId,
  role,
  members,
  currentUserId,
}: {
  workspaceId: string;
  role: Role;
  members: Member[];
  currentUserId: string | null;
}) {
  const [scheduling, setScheduling] = useState(false);

  const upcoming = useMeetings(workspaceId, 'upcoming');
  const schedule = useScheduleMeeting(workspaceId);
  const respond = useRespondToMeeting(workspaceId);
  const cancel = useCancelMeeting(workspaceId);

  const meetings = upcoming.data?.meetings ?? [];
  // A link to one meeting (from search) opens at it.
  useScrollToHash(meetings.length > 0);

  return (
    <div className="space-y-3">
      {can(role, 'meeting:create') ? (
        <>
          <Button variant="primary" className="w-full" onClick={() => setScheduling(true)}>
            Schedule a meeting
          </Button>
          <ImportCalendar workspaceId={workspaceId} />
        </>
      ) : null}

      {upcoming.isError ? (
        <InlineError>Could not load meetings.</InlineError>
      ) : upcoming.isPending ? (
        <p className="text-xs text-faint">Loading…</p>
      ) : meetings.length === 0 ? (
        <EmptyView view="meetings" workspaceId={workspaceId} />
      ) : (
        <ul className="space-y-2">
          {meetings.map((meeting) => (
            <li key={meeting.id} id={`meeting-${meeting.id}`} className="scroll-mt-24">
              <MeetingCard
                workspaceId={workspaceId}
                meeting={meeting}
                currentUserId={currentUserId}
                canCancel={
                  meeting.organizerId === currentUserId
                    ? can(role, 'meeting:manage_own')
                    : can(role, 'meeting:manage_any')
                }
                onRespond={(response) => respond.mutate({ meetingId: meeting.id, response })}
                onCancel={() => cancel.mutate(meeting.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <ScheduleDialog
        open={scheduling}
        members={members}
        currentUserId={currentUserId}
        saving={schedule.isPending}
        error={
          schedule.error instanceof ApiError
            ? schedule.error.message
            : schedule.error
              ? 'Could not schedule that meeting.'
              : null
        }
        onCancel={() => setScheduling(false)}
        onSubmit={(meeting) => schedule.mutate(meeting, { onSuccess: () => setScheduling(false) })}
      />
    </div>
  );
}
