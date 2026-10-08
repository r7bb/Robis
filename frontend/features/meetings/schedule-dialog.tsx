'use client';

import { MEETING_MAX_MINUTES, MEETING_MIN_MINUTES } from '@robis/shared/limits';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { Avatar } from '../../components/ui/avatar.tsx';
import { Button, InlineError } from '../../components/ui/primitives.tsx';
import type { Member } from '../../lib/api.ts';
import { toLocalInputValue } from '../../lib/time.ts';
import type { NewMeeting } from './types.ts';

/**
 * Schedule a meeting.
 *
 * Built on the native `<dialog>` element rather than a div with a high
 * z-index. `showModal()` brings a focus trap, Escape to dismiss, an inert
 * background and a `::backdrop` pseudo-element for free -- all of which are
 * easy to implement badly by hand, and three of which are accessibility
 * failures when you do.
 */

const DURATIONS = [15, 30, 45, 60, 90, 120] as const;

const INPUT =
  'w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-content placeholder:text-faint focus:border-accent-soft focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-soft';

/** Round up to the next half hour: nobody schedules a meeting for 2:07. */
function nextSlot(): Date {
  const date = new Date();
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() + (30 - (date.getMinutes() % 30)));

  return date;
}

/**
 * A room name with enough entropy that it cannot be guessed.
 *
 * The link is the only thing protecting the room, so a readable slug like
 * `robis-standup` would be a room anyone could walk into. 128 bits of
 * randomness via `crypto` -- `Math.random` is not suitable for something
 * acting as a credential.
 */
function generateRoomUrl(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const slug = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

  return `https://meet.jit.si/robis-${slug}`;
}

function Field({
  id,
  label,
  optional,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted">
        {label}
        {optional ? <span className="ml-1 font-normal text-faint">optional</span> : null}
      </label>
      {children}
    </div>
  );
}

export function ScheduleDialog({
  open,
  members,
  currentUserId,
  saving,
  error,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  members: Member[];
  currentUserId: string | null;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (meeting: NewMeeting) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fieldId = useId();

  const [title, setTitle] = useState('');
  const [agenda, setAgenda] = useState('');
  const [startsAt, setStartsAt] = useState(() => toLocalInputValue(nextSlot()));
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [joinUrl, setJoinUrl] = useState('');
  const [invited, setInvited] = useState<Set<string>>(new Set());

  /*
   * `open` is a prop, but `<dialog>` keeps its own open state, so the two are
   * reconciled here rather than by rendering `<dialog open>`. The attribute
   * form shows the dialog *non-modally* -- no focus trap, no backdrop, no
   * Escape -- which looks right and behaves wrongly.
   */
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;

    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  // Start fresh each time it opens, so a cancelled draft does not reappear.
  useEffect(() => {
    if (!open) return;

    setTitle('');
    setAgenda('');
    setStartsAt(toLocalInputValue(nextSlot()));
    setDurationMinutes(30);
    setJoinUrl('');
    setInvited(new Set());
  }, [open]);

  function toggle(userId: string) {
    setInvited((current) => {
      // A new Set rather than mutating: React compares by identity, and
      // `current.add(...)` returns the same object, so nothing would repaint.
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);

      return next;
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;

    const trimmed = title.trim();
    if (!trimmed) return;

    onSubmit({
      title: trimmed,
      agenda: agenda.trim() || null,
      // `datetime-local` has no zone, so this parses in the organiser's own
      // timezone -- which is what they meant -- and `toISOString` converts to
      // the UTC instant the server stores.
      startsAt: new Date(startsAt).toISOString(),
      durationMinutes,
      joinUrl: joinUrl.trim() || null,
      attendeeIds: [...invited],
    });
  }

  const invitable = members.filter((member) => member.userId !== currentUserId);

  return (
    <dialog
      ref={dialog}
      // Escape fires `cancel`, which would otherwise close the element
      // without telling the parent, leaving `open` stuck true.
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-line bg-raised p-0 text-content backdrop:bg-black/60"
    >
      <form onSubmit={submit} className="space-y-4 p-5">
        <header>
          <h2 className="text-base font-semibold text-content">Schedule a meeting</h2>
          <p className="mt-0.5 text-xs text-faint">
            Everyone in the workspace can see it. Invitees also get a yes/no.
          </p>
        </header>

        <Field id={`${fieldId}-title`} label="Title">
          <input
            id={`${fieldId}-title`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            required
            placeholder="Sprint planning"
            className={INPUT}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field id={`${fieldId}-start`} label="Starts">
            <input
              id={`${fieldId}-start`}
              type="datetime-local"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
              required
              className={INPUT}
            />
          </Field>

          <Field id={`${fieldId}-duration`} label="Duration">
            <select
              id={`${fieldId}-duration`}
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(Number(event.target.value))}
              className={INPUT}
            >
              {DURATIONS.filter(
                (minutes) => minutes >= MEETING_MIN_MINUTES && minutes <= MEETING_MAX_MINUTES,
              ).map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} minutes
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field id={`${fieldId}-agenda`} label="Agenda" optional>
          <textarea
            id={`${fieldId}-agenda`}
            value={agenda}
            onChange={(event) => setAgenda(event.target.value)}
            rows={3}
            maxLength={5000}
            placeholder="What are we deciding?"
            className={`${INPUT} resize-none`}
          />
        </Field>

        <Field id={`${fieldId}-link`} label="Join link" optional>
          <div className="flex gap-2">
            <input
              id={`${fieldId}-link`}
              type="url"
              value={joinUrl}
              onChange={(event) => setJoinUrl(event.target.value)}
              placeholder="https://…"
              className={INPUT}
            />

            <Button size="sm" onClick={() => setJoinUrl(generateRoomUrl())}>
              Generate
            </Button>
          </div>

          {/*
           * Said plainly, because it is the one thing on this form that
           * involves anyone outside Robis. "Generate" mints a URL for the
           * public Jitsi instance; Robis does not run it, does not book it,
           * and cannot promise it will be there.
           */}
          <p className="mt-1 text-[10px] text-faint">
            Generate creates a random room on the public meet.jit.si service, which is operated by a
            third party. Paste your own link to use something else.
          </p>
        </Field>

        {invitable.length > 0 ? (
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-muted">Invite</legend>

            <ul className="max-h-36 space-y-px overflow-y-auto rounded-md border border-line p-1">
              {invitable.map((member) => (
                <li key={member.userId}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface">
                    <input
                      type="checkbox"
                      checked={invited.has(member.userId)}
                      onChange={() => toggle(member.userId)}
                      className="accent-accent"
                    />
                    <Avatar name={member.name} seed={member.userId} size="sm" />
                    <span className="truncate text-muted">{member.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ) : null}

        {error ? <InlineError>{error}</InlineError> : null}

        <footer className="flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>

          <Button type="submit" variant="primary" disabled={saving || !title.trim()}>
            {saving ? 'Scheduling…' : 'Schedule'}
          </Button>
        </footer>
      </form>
    </dialog>
  );
}
