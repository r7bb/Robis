'use client';

import { contracts } from '@robis/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { call, type NotificationItem } from '../lib/api.ts';
import { describeNotification, notificationHref } from '../lib/notification-text.ts';
import { useInbox } from '../lib/use-inbox.ts';

/**
 * Where a notification takes you.
 *
 * A nudge about creating your first workspace has no workspace to link to, so
 * it falls back to the index -- which is exactly where the action is.
 */
function hrefFor(item: NotificationItem): string {
  // A nudge opens its guide rather than dumping the reader somewhere and
  // leaving them to work out what was being suggested.
  if (item.kind === 'nudge' && item.payload.nudge) {
    const workspace = item.workspaceId ? `?w=${item.workspaceId}` : '';
    return `/guide/${item.payload.nudge}${workspace}`;
  }

  // Not a member yet: the answer is on the workspaces page.
  if (item.kind === 'invitation') return '/workspaces';

  return notificationHref(item);
}

function headlineFor(item: NotificationItem) {
  if (item.kind === 'nudge') return item.payload.title ?? 'Suggestion';

  if (item.kind === 'invitation') {
    return (
      <>
        <span className="font-medium">{item.actorName ?? 'Someone'}</span> invited you to{' '}
        <span className="font-medium">{item.payload.workspaceName ?? 'a workspace'}</span>
      </>
    );
  }

  // A mention, a comment on your issue, an assignment or a meeting change (C3).
  const { actor, did, subject } = describeNotification(item);
  const isIssue = item.kind !== 'meeting';
  return (
    <>
      <span className="font-medium">{actor}</span> {did}
      {subject && (
        <span className={isIssue ? 'ml-1 font-mono text-xs text-faint' : 'ml-1 font-medium'}>
          {subject}
        </span>
      )}
    </>
  );
}

function bodyFor(item: NotificationItem): string | undefined {
  if (item.kind === 'invitation') return 'Accept or decline it on your workspaces page.';
  return item.kind === 'nudge' ? item.payload.body : describeNotification(item).body;
}

/**
 * Inbox for the signed-in user.
 *
 * Scoped by recipient rather than workspace, because notifications span every
 * workspace you belong to; each entry links back into the one it came from.
 */
export function NotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
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

  const items = inbox.data?.notifications ?? [];
  const unread = inbox.data?.unreadCount ?? 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        className="relative rounded-md px-2 py-1 text-sm text-muted hover:text-content"
      >
        Inbox
        {unread > 0 && (
          <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-contrast">
            {unread}
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

          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-faint">Nothing here yet.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {items.map((item) => (
                <li
                  key={item.id}
                  className={`flex items-start hover:bg-surface ${item.readAt ? 'opacity-60' : ''}`}
                >
                  <Link
                    href={hrefFor(item)}
                    onClick={() => {
                      if (!item.readAt) markRead.mutate(item.id);
                      setOpen(false);
                    }}
                    className="min-w-0 flex-1 px-4 py-3"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm text-content">{headlineFor(item)}</span>

                      {!item.readAt && (
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-soft"
                        />
                      )}
                    </div>

                    {bodyFor(item) && (
                      <p className="mt-1 line-clamp-2 text-xs text-faint">{bodyFor(item)}</p>
                    )}
                  </Link>

                  {/* No confirmation here: dismissing an inbox entry destroys
                      nothing, and a modal per notification would be worse than
                      the mistake it prevents. */}
                  <button
                    type="button"
                    onClick={() => dismiss.mutate(item.id)}
                    aria-label="Dismiss notification"
                    title="Dismiss"
                    className="mr-2 mt-2.5 shrink-0 rounded p-1.5 text-faint transition hover:bg-danger/10 hover:text-danger-soft"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      aria-hidden="true"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      className="h-3.5 w-3.5"
                    >
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
