'use client';

import { contracts } from '@robis/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { call } from '../../lib/api.ts';
import { describeNotification, notificationHref } from '../../lib/notification-text.ts';
import { formatRelative } from '../../lib/time.ts';
import { useInbox } from '../../lib/use-inbox.ts';
import { CardLoading, HomeCard } from './home-card.tsx';

/** As many as fit a card at a glance; the inbox has the rest. */
const SHOWN = 6;

/**
 * Where you were mentioned, newest first, unread marked, from the same
 * inbox the bell reads (one request for both). Opening one marks it read.
 */
export function MentionsCard() {
  const queryClient = useQueryClient();
  const inbox = useInbox();
  const markRead = useMutation({
    mutationFn: (id: string) =>
      call(contracts['notifications.read'], { params: { notificationId: id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const mentions = (inbox.data?.notifications ?? []).filter((item) => item.kind === 'mention');
  const unread = mentions.filter((item) => !item.readAt).length;

  return (
    <HomeCard
      id="home-mentions"
      title="Mentions"
      aside={unread > 0 ? <span className="text-xs text-muted">{unread} unread</span> : null}
    >
      {inbox.isPending ? (
        <CardLoading />
      ) : inbox.isError ? (
        <p className="text-sm text-faint">Your mentions could not be loaded.</p>
      ) : mentions.length === 0 ? (
        <p className="text-sm text-faint">
          No mentions. When someone writes your @username, it shows here.
        </p>
      ) : (
        <ul className="space-y-1">
          {mentions.slice(0, SHOWN).map((item) => (
            <MentionRow
              key={item.id}
              item={item}
              onOpen={() => {
                if (!item.readAt) markRead.mutate(item.id);
              }}
            />
          ))}
        </ul>
      )}
    </HomeCard>
  );
}

type Mention = NonNullable<ReturnType<typeof useInbox>['data']>['notifications'][number];

/** One mention: who, on what, when, and the start of what they wrote. */
function MentionRow({ item, onOpen }: { item: Mention; onOpen: () => void }) {
  const text = describeNotification(item);
  return (
    <li>
      <Link
        href={notificationHref(item)}
        onClick={onOpen}
        className="block rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-surface/60 focus-visible:bg-surface/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <span className="flex items-baseline gap-2">
          {item.readAt ? null : (
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 shrink-0 -translate-y-px rounded-full bg-accent"
            />
          )}
          <span className="min-w-0 truncate text-muted">
            <span className="text-content">{text.actor}</span> in{' '}
            <span className="font-mono text-xs">{text.subject ?? 'an issue'}</span>
            <span className="sr-only">{item.readAt ? '' : ', unread'}</span>
          </span>
          <span className="ml-auto shrink-0 text-xs text-faint">
            {formatRelative(new Date(item.createdAt))}
          </span>
        </span>
        {text.body ? (
          <span className="mt-0.5 block truncate text-xs text-faint">{text.body}</span>
        ) : null}
      </Link>
    </li>
  );
}
