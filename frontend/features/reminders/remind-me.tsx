'use client';

import { contracts, type REMINDER_SUBJECTS } from '@robis/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { formatWhen, SnoozeChoices } from '../../components/snooze-choices.tsx';
import { call } from '../../lib/api.ts';

/**
 * Remind me: pick when, and the issue, message or thread comes back to the
 * inbox then, for the one who asked only. `subtle` is the hover-only
 * button beside a chat message; otherwise it is always shown.
 */
export function RemindMe({
  workspaceId,
  about,
  id,
  subtle = false,
}: {
  workspaceId: string;
  about: (typeof REMINDER_SUBJECTS)[number];
  id: string;
  subtle?: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const remind = useMutation({
    mutationFn: (at: Date) =>
      call(contracts['reminders.create'], { params: { workspaceId }, body: { about, id, at } }),
    onSuccess: () => {
      setOpen(false);
      return queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  // Closes on a click outside, as a menu does.
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const set = remind.data?.reminder.at;
  return (
    <div ref={box} className="relative self-start">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={
          subtle
            ? 'rounded px-1.5 py-0.5 text-[10px] text-faint opacity-0 transition-opacity hover:text-content focus-visible:opacity-100 group-hover:opacity-100'
            : 'rounded-md px-2 py-1 text-xs text-muted hover:bg-surface hover:text-content'
        }
      >
        Remind me
      </button>
      {set && !open ? (
        <span role="status" className="ml-1 text-[11px] text-accent-soft">
          Reminder at {formatWhen(set)}
        </span>
      ) : null}
      {open ? (
        <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-line bg-raised p-3 shadow-xl">
          <SnoozeChoices
            framed={false}
            action="Remind me"
            pending={remind.isPending}
            onChoose={(at) => remind.mutate(at)}
            onCancel={() => setOpen(false)}
          />
          {remind.isError ? (
            <p role="alert" className="mt-1 text-xs text-danger-soft">
              {(remind.error as Error).message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
