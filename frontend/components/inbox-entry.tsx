'use client';

import { contracts } from '@robis/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { call, type NotificationItem } from '../lib/api.ts';
import { isWaiting } from '../lib/inbox-tabs.ts';
import { describeNotification, notificationHref } from '../lib/notification-text.ts';
import { formatWhen, SnoozeChoices } from './snooze-choices.tsx';

/** Kinds whose subject is an issue key. */
const ISSUE_KINDS: ReadonlySet<string> = new Set(['mention', 'assignment', 'issue_comment']);
/** A reminder names its issue by key too, when it is about one. */
const namesIssue = (item: NotificationItem) =>
  ISSUE_KINDS.has(item.kind) || (item.kind === 'reminder' && Boolean(item.payload.issueKey));

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

  // A workspace export is ready (C6): downloaded from the People page.
  if (item.kind === 'export' && item.workspaceId) {
    return `/workspaces/${item.workspaceId}/people#exports`;
  }

  return notificationHref(item);
}

function headlineFor(item: NotificationItem) {
  if (item.kind === 'nudge') return item.payload.title ?? 'Suggestion';

  if (item.kind === 'cycle_ending') {
    return (
      <>
        <span className="font-medium">{item.payload.title ?? 'A cycle'}</span> ends tomorrow
      </>
    );
  }

  if (item.kind === 'release_due') {
    return (
      <>
        <span className="font-medium">{item.payload.title ?? 'A release'}</span> is due tomorrow
      </>
    );
  }

  if (item.kind === 'export') {
    return (
      <>
        The export of{' '}
        <span className="font-medium">{item.payload.workspaceName ?? 'a workspace'}</span> is ready
      </>
    );
  }

  if (item.kind === 'invitation') {
    return (
      <>
        <span className="font-medium">{item.actorName ?? 'Someone'}</span> invited you to{' '}
        <span className="font-medium">{item.payload.workspaceName ?? 'a workspace'}</span>
      </>
    );
  }

  // A mention, a comment on your issue, an assignment, a meeting change or
  // news from a space (C3). An issue is named by its key, set as code.
  const { actor, did, subject } = describeNotification(item);
  const isIssue = namesIssue(item);
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
  if (item.kind === 'export') return 'Download it once, from the People page.';
  return item.kind === 'nudge' || item.kind === 'cycle_ending' || item.kind === 'release_due'
    ? item.payload.body
    : describeNotification(item).body;
}

/**
 * One inbox entry: where it leads, put off for later, or dismissed. One
 * waiting under Later says when it is back, and can be brought back now.
 */
export function InboxEntry({
  item,
  onOpen,
  onDismiss,
}: {
  item: NotificationItem;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const queryClient = useQueryClient();
  const [choosing, setChoosing] = useState(false);
  const waiting = isWaiting(item.snoozedUntil, Date.now());
  const snooze = useMutation({
    mutationFn: (until: Date | null) =>
      call(contracts['notifications.snooze'], {
        params: { notificationId: item.id },
        body: { until },
      }),
    onSuccess: () => {
      setChoosing(false);
      return queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  return (
    <li className={item.readAt && !waiting ? 'opacity-60' : ''}>
      <div className="flex items-start hover:bg-surface">
        <Link href={hrefFor(item)} onClick={onOpen} className="min-w-0 flex-1 px-4 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm text-content">{headlineFor(item)}</span>
            {!item.readAt && !waiting && (
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-soft" />
            )}
          </div>
          {bodyFor(item) && <p className="mt-1 line-clamp-2 text-xs text-faint">{bodyFor(item)}</p>}
          {waiting && (
            <p className="mt-1 text-[11px] text-accent-soft">
              Back {formatWhen(item.snoozedUntil!)}
            </p>
          )}
        </Link>
        <div className="mr-2 mt-2 flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => (waiting ? snooze.mutate(null) : setChoosing((open) => !open))}
            aria-expanded={waiting ? undefined : choosing}
            disabled={snooze.isPending}
            className="rounded px-1.5 py-1 text-[11px] text-faint transition hover:bg-raised hover:text-content disabled:opacity-50"
          >
            {waiting ? 'Bring back' : 'Snooze'}
          </button>
          {/* No confirmation here: dismissing an inbox entry destroys
              nothing, and a modal per notification would be worse than
              the mistake it prevents. */}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss notification"
            title="Dismiss"
            className="rounded p-1.5 text-faint transition hover:bg-danger/10 hover:text-danger-soft"
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
        </div>
      </div>
      {choosing && !waiting && (
        <SnoozeChoices
          pending={snooze.isPending}
          onChoose={(until) => snooze.mutate(until)}
          onCancel={() => setChoosing(false)}
        />
      )}
      {snooze.isError && (
        <p role="alert" className="px-4 pb-2 text-xs text-danger-soft">
          {(snooze.error as Error).message}
        </p>
      )}
    </li>
  );
}
