'use client';

import Link from 'next/link';
import { ago } from '../../components/activity-feed.tsx';
import { Avatar } from '../../components/ui/avatar.tsx';
import type { Member } from '../../lib/api.ts';
import { threadHref } from '../../lib/links.ts';
import { KINDS } from '../spaces/spaces-model.ts';
import type { FeedItem } from './feed-model.ts';

type Thread = Extract<FeedItem, { kind: 'thread' }>['thread'];

/** A new thread in a space you follow: one line to open it, not the whole thing. */
export function ThreadCard({
  workspaceId,
  thread,
  people,
}: {
  workspaceId: string;
  thread: Thread;
  people: ReadonlyMap<string, Member>;
}) {
  const author = people.get(thread.authorId);
  const name = author?.name ?? 'Someone';
  return (
    <Link
      href={threadHref(workspaceId, thread.id)}
      className="flex items-center gap-3 rounded-xl border border-line bg-raised px-4 py-3 transition-colors hover:border-accent-soft/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
    >
      <Avatar name={name} seed={thread.authorId} avatar={author?.avatar ?? null} size="md" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-faint">
          {name} started a thread in {thread.spaceName} · {ago(thread.createdAt)}
        </span>
        <span className="block truncate text-sm font-medium text-content">{thread.title}</span>
      </span>
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${KINDS[thread.kind].tone}`}
      >
        {KINDS[thread.kind].label}
      </span>
    </Link>
  );
}
