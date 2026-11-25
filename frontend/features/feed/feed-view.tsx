'use client';

import { can, contracts } from '@robis/shared';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from '../../components/ui/avatar.tsx';
import { BASE_URL, call, type Member } from '../../lib/api.ts';
import { channelHref } from '../../lib/links.ts';
import { ago } from '../../lib/time.ts';
import { useMyId, usePeople } from '../../lib/use-people.ts';
import { useStories } from '../stories/stories-context.tsx';
import { StoriesStrip } from '../stories/stories-strip.tsx';
import { useWorkspaceRole } from '../workspace/page-frame.tsx';
import { Celebrations } from './celebrations.tsx';
import { CheckIn } from './check-in.tsx';
import { type FeedItem, feedKey, itemAuthor, itemKey, splitAtSeen } from './feed-model.ts';
import { type FeedTab, FeedTabs, panelId, tabId, useFeedTab } from './feed-tabs.tsx';
import { useFollows } from './follow-button.tsx';
import { FollowingEmpty } from './following-empty.tsx';
import { HereNow } from './here-now.tsx';
import { PostCard } from './post-card.tsx';
import { PostComposer } from './post-composer.tsx';
import { ProjectHealthCards } from './project-health.tsx';
import { ShotsStack } from './shots-stack.tsx';
import { TeamWeek } from './team-week.tsx';
import { ThreadCard } from './thread-card.tsx';
import { YourDay } from './your-day.tsx';

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
function useFeed(workspaceId: string, me: string | null, scope: FeedScope) {
  const feed = useInfiniteQuery({
    queryKey: [...feedKey(workspaceId), scope],
    queryFn: ({ pageParam }) =>
      call(contracts['feed.list'], {
        params: { workspaceId },
        query: pageParam ? { before: pageParam, scope } : { scope },
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
    // Caught up means the whole workspace: only Everyone moves the mark.
    if (!firstPage || marked.current || scope !== 'everyone') return;
    marked.current = true;
    markSeen();
  }, [firstPage, markSeen, scope]);

  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];
  return {
    feed,
    items,
    neverSeen: !firstPage?.seenAt,
    checkedIn: firstPage ? firstPage.checkedInThisWeek : true,
    // Following is a short list you chose, so all of it shows, newest first:
    // someone just followed should not arrive already behind Show earlier.
    ...(scope === 'following'
      ? { fresh: items, earlier: [] }
      : splitAtSeen(items, seenOnArrival.current ?? null, me, arrivedAt.current)),
  };
}

type FeedScope = FeedTab;

/** The posts of one scope: what is new, the end, and earlier behind a button. */
function FeedList({
  workspaceId,
  scope,
  me,
  members,
  people,
  onCheckedIn,
}: {
  workspaceId: string;
  scope: FeedScope;
  me: string | null;
  members: readonly Member[];
  people: ReadonlyMap<string, Member>;
  onCheckedIn: (checkedIn: boolean) => void;
}) {
  const { role } = useWorkspaceRole();
  const { following } = useFollows(workspaceId);
  const { feed, items, neverSeen, fresh, earlier, checkedIn } = useFeed(workspaceId, me, scope);
  const [showEarlier, setShowEarlier] = useState(false);
  useEffect(() => onCheckedIn(checkedIn), [checkedIn, onCheckedIn]);
  const more = earlier.length > 0 || feed.hasNextPage;
  const card = (item: FeedItem) => (
    <li key={itemKey(item)}>
      {item.kind === 'post' ? (
        <PostCard workspaceId={workspaceId} post={item.post} people={people} me={me} role={role} />
      ) : item.kind === 'thread' ? (
        <ThreadCard workspaceId={workspaceId} thread={item.thread} people={people} />
      ) : (
        <PictureCard workspaceId={workspaceId} picture={item.picture} people={people} />
      )}
    </li>
  );
  const othersHere = items.some((item) => itemAuthor(item) !== me);

  if (feed.isPending) return <FeedSkeleton />;
  return (
    <>
      <ul className="mt-4 space-y-4">
        {scope === 'following' && !othersHere ? (
          <li>
            <FollowingEmpty
              workspaceId={workspaceId}
              me={me}
              members={members}
              followingAnyone={following.size > 0}
            />
          </li>
        ) : null}
        {fresh.map(card)}
        <li>
          <CaughtUp first={neverSeen && items.length === 0} />
        </li>
        {showEarlier ? earlier.map(card) : null}
      </ul>
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
    </>
  );
}

export function FeedView({ workspaceId }: { workspaceId: string }) {
  const { role } = useWorkspaceRole();
  const myId = useMyId();
  const { list: members, people } = usePeople(workspaceId);
  const stories = useStories();
  const [tab, setTab] = useFeedTab(workspaceId);
  const [listed, setListed] = useState<boolean | null>(null);
  const checkedIn = listed ?? true;
  const [draft, setDraft] = useState<{ words: string; at: number } | null>(null);
  const mayPost = role ? can(role, 'post:create') : false;
  const mayReadWork = role ? can(role, 'issue:read') : false;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
      <h1 className="text-balance text-lg font-semibold tracking-tight text-content">Feed</h1>
      <p className="mt-1 text-sm text-muted">
        What the team has been sharing. It ends where you last caught up.
      </p>
      <HereNow workspaceId={workspaceId} me={myId} people={people} />
      {stories?.enabled ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-line bg-raised">
          <StoriesStrip members={members} />
        </div>
      ) : null}
      {mayPost ? (
        <div className="mt-4">
          <PostComposer workspaceId={workspaceId} draft={draft} />
        </div>
      ) : null}

      <FeedTabs tab={tab} onChange={setTab} waiting={mayPost && !checkedIn} />
      <section id={panelId(tab)} role="tabpanel" aria-labelledby={tabId(tab)}>
        {tab === 'everyone' ? (
          <Highlights
            workspaceId={workspaceId}
            me={myId}
            people={people}
            mayPost={mayPost}
            mayReadWork={mayReadWork}
            checkedIn={checkedIn}
            onWellDone={(words) => setDraft({ words, at: Date.now() })}
          />
        ) : null}
        <FeedList
          key={tab}
          workspaceId={workspaceId}
          scope={tab}
          me={myId}
          members={members}
          people={people}
          onCheckedIn={setListed}
        />
      </section>
    </div>
  );
}

/**
 * What is happening, above the posts on Everyone: your day (what is overdue
 * and due today), this week's check-in, the
 * day's Different shots, the week's celebrations and how the projects are
 * doing, each for those who may use it.
 */
function Highlights({
  workspaceId,
  me,
  people,
  mayPost,
  mayReadWork,
  checkedIn,
  onWellDone,
}: {
  workspaceId: string;
  me: string | null;
  people: ReadonlyMap<string, Member>;
  mayPost: boolean;
  mayReadWork: boolean;
  checkedIn: boolean;
  onWellDone: (words: string) => void;
}) {
  return (
    <div className="mt-2">
      {mayReadWork ? <YourDay workspaceId={workspaceId} /> : null}
      {mayPost && !checkedIn ? <CheckIn workspaceId={workspaceId} /> : null}
      <ShotsStack people={people} />
      {mayReadWork ? (
        <Celebrations
          workspaceId={workspaceId}
          me={me}
          people={people}
          onWellDone={mayPost ? onWellDone : undefined}
        />
      ) : null}
      {mayReadWork ? <TeamWeek workspaceId={workspaceId} /> : null}
      {mayReadWork ? <ProjectHealthCards workspaceId={workspaceId} /> : null}
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
