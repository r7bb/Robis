'use client';

import { contracts } from '@robis/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { call } from '../lib/api.ts';
import { INBOX_TAB_NAMES, INBOX_TABS, type InboxTab, splitInbox } from '../lib/inbox-tabs.ts';
import { useInbox } from '../lib/use-inbox.ts';
import { InboxEntry } from './inbox-entry.tsx';

const EMPTY_LINES: Record<InboxTab, string> = {
  priority:
    'Nothing needs you. Mentions, issues given to you, invitations and meeting changes land here.',
  other: 'Nothing else yet. Comments on your issues, replies in spaces and suggestions land here.',
  later: 'Nothing snoozed. Snooze an entry to have it come back when it suits you.',
};

/**
 * Inbox for the signed-in user.
 *
 * Scoped by recipient rather than workspace, because notifications span every
 * workspace you belong to; each entry links back into the one it came from.
 */
export function NotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<InboxTab>('priority');
  const containerRef = useRef<HTMLDivElement>(null);

  const inbox = useInbox();

  const markRead = useMutation({
    mutationFn: (id: string) =>
      call(contracts['notifications.read'], { params: { notificationId: id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const dismiss = useMutation({
    mutationFn: (id: string) =>
      call(contracts['notifications.delete'], { params: { notificationId: id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllRead = useMutation({
    mutationFn: () => call(contracts['notifications.readAll']),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  // Close on an outside click or Escape, the way a menu is expected to behave.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Signed out, or the API is unreachable: show nothing rather than an error.
  if (inbox.isError) return null;

  const unread = inbox.data?.unreadCount ?? 0;
  const split = splitInbox(inbox.data?.notifications ?? []);
  const items = split[tab].items;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="relative rounded-md px-2 py-1 text-sm text-muted hover:text-content"
      >
        {/* Named by its own words, the count read as "N unread" (C9). */}
        Inbox
        {unread > 0 && (
          <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-contrast">
            {unread}
            <span className="sr-only"> unread</span>
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-2 w-96 overflow-hidden rounded-lg border border-line bg-raised shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-2">
            <span className="text-xs font-medium uppercase tracking-wide text-faint">
              Notifications
            </span>

            {unread > 0 && (
              <button
                type="button"
                onClick={() => markAllRead.mutate()}
                className="text-xs text-muted hover:text-content"
              >
                Mark all read
              </button>
            )}
          </div>

          <InboxTabs current={tab} split={split} onChoose={setTab} />

          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-faint">{EMPTY_LINES[tab]}</p>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {items.map((item) => (
                <InboxEntry
                  key={item.id}
                  item={item}
                  onOpen={() => {
                    if (!item.readAt) markRead.mutate(item.id);
                    setOpen(false);
                  }}
                  onDismiss={() => dismiss.mutate(item.id)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Priority and Other, as a tab strip: the arrow keys move between them and
 * only the chosen one is in the Tab order. Each shows its unread count.
 */
function InboxTabs({
  current,
  split,
  onChoose,
}: {
  current: InboxTab;
  split: ReturnType<typeof splitInbox>;
  onChoose: (tab: InboxTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Notifications"
      className="flex gap-1 border-b border-line px-3 pt-2"
      onKeyDown={(event) => {
        const step = { ArrowRight: 1, ArrowLeft: -1, Home: 0, End: 0 }[event.key];
        if (step === undefined) return;
        event.preventDefault();
        // Kept now: the event's target is gone by the time the frame runs.
        const list = event.currentTarget;
        const at = INBOX_TABS.indexOf(current);
        const index =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? INBOX_TABS.length - 1
              : (at + step + INBOX_TABS.length) % INBOX_TABS.length;
        const next = INBOX_TABS[index]!;
        onChoose(next);
        requestAnimationFrame(() =>
          list.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus(),
        );
      }}
    >
      {INBOX_TABS.map((tab) => {
        const selected = tab === current;
        const unread = split[tab].unread;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            data-tab={tab}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChoose(tab)}
            className={`-mb-px border-b-2 px-2 pb-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${
              selected
                ? 'border-accent text-content'
                : 'border-transparent text-faint hover:text-muted'
            }`}
          >
            {INBOX_TAB_NAMES[tab]}
            {unread > 0 ? <span className="ml-1.5 text-faint">{unread}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
