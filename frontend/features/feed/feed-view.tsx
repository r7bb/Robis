'use client';

import { can, contracts } from '@robis/shared';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ago } from '../../components/activity-feed.tsx';
import { Avatar } from '../../components/ui/avatar.tsx';
import { BASE_URL, call, type Member } from '../../lib/api.ts';
import { channelHref } from '../../lib/links.ts';
import { useStories } from '../stories/stories-context.tsx';
import { StoriesStrip } from '../stories/stories-strip.tsx';
import { useWorkspaceRole } from '../workspace/page-frame.tsx';
import { CheckIn } from './check-in.tsx';
import { type FeedItem, feedKey, itemKey, splitAtSeen } from './feed-model.ts';
import { PostCard } from './post-card.tsx';
import { PostComposer } from './post-composer.tsx';
import { ShotsStack } from './shots-stack.tsx';

/**
 * The feed (Phase 2c): the team's stories along the top, then what has
 * happened since you last caught up, newest first, and then the end: "You
 * are all caught up". Anything older is one Show earlier away and never
 * loads on its own, so the feed is something you finish, not something
 * that keeps you.
 */
/**
 * The feed's pages, and where you had caught up when you came: kept for this
 * visit, while the visit itself is marked as the new point, so coming back
 * shows only what is newer.
 */
function useFeed(workspaceId: string, me: string | null) {
  const feed = useInfiniteQuery({
    queryKey: feedKey(workspaceId),
    queryFn: ({ pageParam }) =>
      call(contracts['feed.list'], {
        params: { workspaceId },
        query: pageParam ? { before: pageParam } : {},
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });
  const seenOnArrival = useRef<string | null | undefined>(undefined);
  const arrivedAt = useRef(Number.POSITIVE_INFINITY);
  const firstPage = feed.data?.pages[0];
  if (firstPage && seenOnArrival.current === undefined) {
    seenOnArrival.current = firstPage.seenAt;
    arrivedAt.current = Date.now();
  }
  const { mutate: markSeen } = useMutation({
    mutationFn: () => call(contracts['feed.seen'], { params: { workspaceId } }),
  });
  const marked = useRef(false);
  useEffect(() => {
    if (!firstPage || marked.current) return;
    marked.current = true;
    markSeen();
  }, [firstPage, markSeen]);

  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];
  return {
    feed,
    items,
    neverSeen: !firstPage?.seenAt,
    ...splitAtSeen(items, seenOnArrival.current ?? null, me, arrivedAt.current),
  };
}

function usePeople(workspaceId: string) {
  const members = useQuery({
    queryKey: ['members', workspaceId],
    queryFn: () => call(contracts['members.list'], { params: { workspaceId } }),
  });
  const list = members.data?.members;
  const people = useMemo(
    () => new Map((list ?? []).map((member) => [member.userId, member])),
    [list],
  );
  return { list: list ?? [], people };
}

export function FeedView({ workspaceId }: { workspaceId: string }) {
  const { role } = useWorkspaceRole();
  const stories = useStories();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => call(contracts['auth.me']),
    retry: false,
  });
  const { list: memberList, people } = usePeople(workspaceId);
  const myId = me.data?.user.id ?? null;
  const { feed, items, neverSeen, fresh, earlier } = useFeed(workspaceId, myId);
  const [showEarlier, setShowEarlier] = useState(false);
  const more = earlier.length > 0 || feed.hasNextPage;
  const card = (item: FeedItem) => (
    <li key={itemKey(item)}>
      {item.kind === 'post' ? (
        <PostCard
          workspaceId={workspaceId}
          post={item.post}
          people={people}
          me={myId}
          role={role}
        />
      ) : (
        <PictureCard workspaceId={workspaceId} picture={item.picture} people={people} />
      )}
    </li>
  );

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
      <h1 className="text-balance text-lg font-semibold tracking-tight text-content">Feed</h1>
      <p className="mt-1 text-sm text-muted">
        What the team has been sharing. It ends where you last caught up.
      </p>
      {stories?.enabled ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-line bg-raised">
          <StoriesStrip members={memberList} />
        </div>
      ) : null}
      {role && can(role, 'post:create') && feed.data && !feed.data.pages[0]?.checkedInThisWeek ? (
        <CheckIn workspaceId={workspaceId} />
      ) : null}
      <ShotsStack people={people} />
      {role && can(role, 'post:create') ? (
        <div className="mt-4">
          <PostComposer workspaceId={workspaceId} />
        </div>
      ) : null}

      {feed.isPending ? (
        <FeedSkeleton />
      ) : (
        <ul className="mt-6 space-y-4">
          {fresh.map(card)}
          <li>
            <CaughtUp first={neverSeen && items.length === 0} />
          </li>
          {showEarlier ? earlier.map(card) : null}
        </ul>
      )}

      {more ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            disabled={feed.isFetchingNextPage}
            onClick={() => {
              if (!showEarlier) setShowEarlier(true);
              else void feed.fetchNextPage();
            }}
            className="rounded-full border border-line px-4 py-1.5 text-sm text-muted transition-colors hover:bg-raised hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-50"
          >
            {feed.isFetchingNextPage ? 'Loading…' : 'Show earlier'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The end of what is new: a place to stop, not a prompt to keep going. */
function CaughtUp({ first }: { first: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line px-6 py-8 text-center">
      <span
        aria-hidden="true"
        className="grid h-9 w-9 place-items-center rounded-full bg-accent/15 text-accent-soft"
      >
        ✓
      </span>
      <p className="text-sm font-medium text-content">
        {first ? 'Nothing here yet' : 'You’re all caught up'}
      </p>
      <p className="max-w-[40ch] text-xs text-faint">
        {first
          ? 'Share something above, or post a picture in a room: it shows here too.'
          : 'That is everything new since you last looked. Back to the work.'}
      </p>
    </div>
  );
}

/** A picture from a room, linking back to where it was said. */
function PictureCard({
  workspaceId,
  picture,
  people,
}: {
  workspaceId: string;
  picture: Extract<FeedItem, { kind: 'picture' }>['picture'];
  people: ReadonlyMap<string, Member>;
}) {
  const author = people.get(picture.authorId);
  const name = author?.name ?? 'Someone';
  return (
    <article
      className="rounded-xl border border-line bg-raised"
      aria-label={`Picture from ${name}`}
    >
      <header className="flex items-center gap-3 px-4 pt-4">
        <Avatar name={name} seed={picture.authorId} avatar={author?.avatar ?? null} size="md" />
        <p className="min-w-0 flex-1 text-sm leading-tight text-muted">
          <span className="font-medium text-content">{name}</span> posted a picture in chat
          <span className="block text-xs text-faint">{ago(picture.createdAt)}</span>
        </p>
        <Link
          href={channelHref(workspaceId, picture.channelId)}
          className="rounded-full border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:bg-surface hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
        >
          Open the room
        </Link>
      </header>
      <div className="mt-3 bg-surface pb-px">
        {/* biome-ignore lint/performance/noImgElement: members-only bytes with the session cookie */}
        <img
          src={`${BASE_URL}${picture.url}`}
          alt={`Shared by ${name}`}
          width={picture.width}
          height={picture.height}
          loading="lazy"
          decoding="async"
          className="mx-auto block h-auto max-h-[28rem] w-auto max-w-full object-contain"
        />
      </div>
    </article>
  );
}

function FeedSkeleton() {
  return (
    <ul className="mt-6 space-y-4" aria-busy="true">
      {[0, 1, 2].map((n) => (
        <li
          key={n}
          className="h-40 animate-pulse rounded-xl border border-line bg-raised motion-reduce:animate-none"
        />
      ))}
    </ul>
  );
}
