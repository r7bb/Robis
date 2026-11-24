'use client';

import { can, contracts } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ago } from '../../components/activity-feed.tsx';
import { Avatar } from '../../components/ui/avatar.tsx';
import { call, type Member } from '../../lib/api.ts';
import { spacesHref, threadHref } from '../../lib/links.ts';
import { usePeople } from '../../lib/use-people.ts';
import { REACTION_MARKS, type Reaction } from '../feed/feed-model.ts';
import { useWorkspaceRole } from '../workspace/page-frame.tsx';
import { SolvedChip } from './solved-chip.tsx';
import {
  KINDS,
  repliesLine,
  SORTS,
  type Space,
  spacesKey,
  type ThreadSort,
  type ThreadSummary,
  tileTone,
} from './spaces-model.ts';
import { ThreadComposer } from './thread-composer.tsx';

/**
 * One space: its threads, most recently active first or sorted another
 * way, and a place to ask or share. A solved question says so on the list.
 */

export function KindChip({ kind }: { kind: ThreadSummary['kind'] }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${KINDS[kind].tone}`}
    >
      {KINDS[kind].label}
    </span>
  );
}

/** The marks reacted with, with nobody counted: faces live on the thread itself. */
function Marks({ reactions }: { reactions: ThreadSummary['reactions'] }) {
  const used = (Object.keys(reactions) as Reaction[]).filter((r) => reactions[r].length > 0);
  if (used.length === 0) return null;
  return (
    <span aria-hidden="true" className="flex gap-0.5 text-xs">
      {used.map((r) => (
        <span key={r}>{REACTION_MARKS[r]}</span>
      ))}
    </span>
  );
}

function ThreadRow({
  workspaceId,
  thread,
  author,
}: {
  workspaceId: string;
  thread: ThreadSummary;
  author: Member | undefined;
}) {
  return (
    <Link
      href={threadHref(workspaceId, thread.id)}
      className="block rounded-xl border border-line bg-raised p-4 shadow-sm transition-[border-color,box-shadow] hover:border-accent-soft/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <KindChip kind={thread.kind} />
        {thread.solved ? <SolvedChip /> : null}
      </div>
      <h3 className="mt-2 text-pretty text-[15px] font-semibold leading-snug text-content">
        {thread.title}
      </h3>
      {thread.excerpt ? (
        <p className="mt-1 line-clamp-2 text-sm text-muted">{thread.excerpt}</p>
      ) : null}
      <div className="mt-3 flex items-center gap-2 text-xs text-faint">
        <Avatar
          name={author?.name ?? 'Someone'}
          seed={thread.authorId}
          avatar={author?.avatar ?? null}
          size="sm"
        />
        <span className="truncate">
          {author?.name ?? 'Someone'} · {ago(thread.createdAt)}
        </span>
        <span aria-hidden="true">·</span>
        <span className="shrink-0">{repliesLine(thread.replyCount)}</span>
        <span className="ml-auto">
          <Marks reactions={thread.reactions} />
        </span>
      </div>
    </Link>
  );
}

function FollowSpace({ workspaceId, space }: { workspaceId: string; space: Space }) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: (on: boolean) =>
      call(contracts[on ? 'spaces.follow' : 'spaces.unfollow'], {
        params: { workspaceId, spaceId: space.id },
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: spacesKey(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: ['feed', workspaceId] });
    },
  });
  return (
    <button
      type="button"
      aria-pressed={space.following}
      disabled={toggle.isPending}
      onClick={() => toggle.mutate(!space.following)}
      title="New threads here come to your Following feed"
      className={`ml-auto shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-50 ${
        space.following
          ? 'border-line text-muted hover:text-content'
          : 'border-accent/40 bg-accent/10 font-medium text-accent-soft hover:bg-accent/20'
      }`}
    >
      {space.following ? 'Following' : 'Follow'}
    </button>
  );
}

function SpaceHeading({ workspaceId, space }: { workspaceId: string; space: Space | undefined }) {
  return (
    <div className="mt-2 flex items-center gap-3">
      {space ? (
        <span
          aria-hidden="true"
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-lg font-semibold ${tileTone(space.id)}`}
        >
          {space.name.slice(0, 1).toUpperCase()}
        </span>
      ) : null}
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold tracking-tight text-content">
          {space?.name ?? 'Space'}
        </h1>
        {space?.description ? <p className="text-sm text-muted">{space.description}</p> : null}
      </div>
      {space ? <FollowSpace workspaceId={workspaceId} space={space} /> : null}
    </div>
  );
}

export function SpaceView({ workspaceId, spaceId }: { workspaceId: string; spaceId: string }) {
  const { role } = useWorkspaceRole();
  const { people } = usePeople(workspaceId);
  const [sort, setSort] = useState<ThreadSort>('active');
  const page = useQuery({
    queryKey: [...spacesKey(workspaceId), spaceId, sort],
    queryFn: () =>
      call(contracts['spaces.threads'], { params: { workspaceId, spaceId }, query: { sort } }),
  });
  const space = page.data?.space;
  const threads = page.data?.threads ?? [];
  const mayAsk = role ? can(role, 'post:create') : false;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <nav aria-label="Breadcrumb" className="text-xs text-faint">
        <Link href={spacesHref(workspaceId)} className="hover:text-content hover:underline">
          Spaces
        </Link>
      </nav>
      <SpaceHeading workspaceId={workspaceId} space={space} />

      {mayAsk && space ? (
        <div className="mt-5">
          <ThreadComposer workspaceId={workspaceId} spaceId={spaceId} spaceName={space.name} />
        </div>
      ) : null}

      <div
        role="toolbar"
        aria-label="Sort threads"
        className="mt-5 inline-flex rounded-lg border border-line bg-raised p-0.5"
      >
        {(Object.keys(SORTS) as ThreadSort[]).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={sort === id}
            onClick={() => setSort(id)}
            className={`rounded-md px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${sort === id ? 'bg-surface font-medium text-content shadow-sm' : 'text-muted hover:text-content'}`}
          >
            {SORTS[id]}
          </button>
        ))}
      </div>

      <ThreadList
        workspaceId={workspaceId}
        threads={threads}
        people={people}
        sort={sort}
        state={page.isError ? 'error' : page.isPending ? 'loading' : 'ready'}
      />
    </div>
  );
}

function ThreadList({
  workspaceId,
  threads,
  people,
  sort,
  state,
}: {
  workspaceId: string;
  threads: ThreadSummary[];
  people: ReadonlyMap<string, Member>;
  sort: ThreadSort;
  state: 'error' | 'loading' | 'ready';
}) {
  if (state === 'error') {
    return (
      <p role="alert" className="mt-4 text-sm text-muted">
        This space could not be loaded. It may be gone, or try again in a moment.
      </p>
    );
  }
  if (state === 'loading') {
    return (
      <ul className="mt-4 space-y-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-28 animate-pulse rounded-xl border border-line bg-raised" />
        ))}
      </ul>
    );
  }
  if (threads.length === 0) {
    return (
      <p className="mt-4 rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
        {sort === 'unanswered'
          ? 'Every question here has an answer.'
          : 'Nothing here yet. Be the first to ask or share.'}
      </p>
    );
  }
  return (
    <ul className="mt-4 space-y-3">
      {threads.map((thread) => (
        <li key={thread.id}>
          <ThreadRow
            workspaceId={workspaceId}
            thread={thread}
            author={people.get(thread.authorId)}
          />
        </li>
      ))}
    </ul>
  );
}
