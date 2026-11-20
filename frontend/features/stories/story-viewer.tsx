'use client';

import { can, contracts, type Role } from '@robis/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Avatar } from '../../components/ui/avatar.tsx';
import { ApiError, BASE_URL, call, type Member } from '../../lib/api.ts';
import {
  ageOf,
  type Place,
  placeAfter,
  placeBefore,
  STORY_SHOW_MS,
  type Story,
  startAt,
  storiesKey,
  TONE_BACKGROUNDS,
} from './story-model.ts';

/**
 * A person's stories, full screen (B2), then the next person's.
 *
 * Each plays for six seconds behind a bar at the top; a tap on the right
 * or the right arrow goes on, on the left or the left arrow goes back,
 * holding pauses, Space pauses, Escape closes. With reduced motion nothing
 * plays on its own: you move through them yourself.
 */

/** A press held this long is a pause, not a tap: letting go does not move on. */
const HOLD_MS = 250;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export function StoryViewer({
  workspaceId,
  startAuthor,
  order: liveOrder,
  grouped,
  seen,
  people,
  me,
  role,
  onSeen,
  onClose,
}: {
  workspaceId: string;
  startAuthor: string;
  order: string[];
  grouped: ReadonlyMap<string, Story[]>;
  seen: ReadonlySet<string>;
  people: ReadonlyMap<string, Member>;
  me: string | null;
  role: Role | undefined;
  onSeen: (storyId: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const reduced = useReducedMotion();
  // The order as it was when opened: seeing stories reorders the strip, and
  // the viewer must not jump about under you because of it.
  const [order] = useState(() => (liveOrder.includes(startAuthor) ? liveOrder : [startAuthor]));
  const [place, setPlace] = useState<Place>(() => ({
    author: Math.max(0, order.indexOf(startAuthor)),
    story: startAt(grouped.get(startAuthor) ?? [], seen),
  }));
  // Paused by the button or Space, and held down by a finger: two reasons,
  // so letting go after a hold does not undo a pause asked for on purpose.
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);

  const authorId = order[place.author];
  const stories = authorId ? (grouped.get(authorId) ?? []) : [];
  const story = stories[Math.min(place.story, stories.length - 1)];

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  // A story gone from the list (taken down, expired), or a person with none
  // left: on to whatever is next, or back, and close only with nothing left.
  useEffect(() => {
    if (story) {
      onSeen(story.id);
      return;
    }
    const elsewhere =
      placeAfter({ ...place, story: Number.MAX_SAFE_INTEGER }, order, grouped, seen) ??
      (place.author > 0 ? placeBefore({ ...place, story: 0 }, order, grouped) : null);
    if (elsewhere && (grouped.get(order[elsewhere.author] ?? '')?.length ?? 0) > 0) {
      setPlace(elsewhere);
    } else onClose();
  }, [story, place, order, grouped, seen, onSeen, onClose]);

  const next = useCallback(() => {
    const target = placeAfter(place, order, grouped, seen);
    if (target) setPlace(target);
    else onClose();
  }, [place, order, grouped, seen, onClose]);

  const previous = useCallback(() => {
    setPlace(placeBefore(place, order, grouped));
  }, [place, order, grouped]);

  // Holding pauses; a short press is a tap that moves on or back.
  const pressedAt = useRef(0);
  const press = (go: () => void) => ({
    onPointerDown: () => {
      pressedAt.current = Date.now();
      setHeld(true);
    },
    onPointerUp: () => setHeld(false),
    onPointerLeave: () => setHeld(false),
    onClick: () => {
      if (Date.now() - pressedAt.current < HOLD_MS) go();
    },
  });

  function onKeyDown(event: React.KeyboardEvent) {
    // Space on a focused button presses that button, as it should.
    if (event.key === ' ' && event.target instanceof HTMLButtonElement) return;
    if (event.key === 'ArrowRight') next();
    else if (event.key === 'ArrowLeft') previous();
    else if (event.key === ' ') setPaused((was) => !was);
    else return;
    event.preventDefault();
  }

  if (!story || !authorId) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={(event) => {
        if (!event.currentTarget.open) onClose();
      }}
      className="story-viewer m-0 h-dvh max-h-none w-full max-w-none bg-transparent p-0 text-white backdrop:bg-black/90 backdrop:backdrop-blur-sm"
    >
      <div className="relative mx-auto flex h-full w-full max-w-[min(100%,calc(100dvh*9/16))] flex-col sm:max-w-[calc(96dvh*9/16)] overflow-hidden bg-black sm:my-[2vh] sm:h-[96dvh] sm:rounded-2xl">
        <StoryFrame story={story} by={people.get(authorId)?.name ?? 'someone'} />

        {/* Tap zones: back on the left third, on everywhere else. */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          {...press(previous)}
          className="absolute inset-y-0 left-0 z-10 w-1/3 cursor-w-resize touch-manipulation"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          {...press(next)}
          className="absolute inset-y-0 right-0 z-10 w-2/3 cursor-e-resize touch-manipulation"
        />

        <div className="absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/60 to-transparent px-3 pb-8 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <Progress
            stories={stories}
            current={story.id}
            playing={!reduced && !paused && !held}
            moving={!reduced}
            onDone={next}
          />
          <ViewerHeader
            workspaceId={workspaceId}
            titleId={titleId}
            story={story}
            author={people.get(authorId)}
            mine={authorId === me}
            role={role}
            paused={paused}
            onPause={() => setPaused((was) => !was)}
            onClose={onClose}
          />
        </div>

        <div className="absolute inset-x-0 bottom-0 z-20 flex justify-between px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-xs text-white/60">
          <button type="button" onClick={previous} className={CHROME}>
            Back
          </button>
          <button type="button" onClick={next} className={CHROME}>
            Next
          </button>
        </div>
      </div>
    </dialog>
  );
}

const CHROME =
  'relative z-30 rounded-full px-3 py-1.5 text-xs text-white/85 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50';

/**
 * One bar per story: the ones shown full, the one showing filling over its
 * six seconds (restarted for each story by its key), the rest empty.
 */
function Progress({
  stories,
  current,
  playing,
  moving,
  onDone,
}: {
  stories: readonly Story[];
  current: string;
  playing: boolean;
  moving: boolean;
  onDone: () => void;
}) {
  const at = stories.findIndex((item) => item.id === current);
  return (
    <div className="flex gap-1" aria-hidden="true">
      {stories.map((item, place) => {
        const showing = item.id === current;
        const fill = fillOf(place, at, moving);
        return (
          <span key={item.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
            <span
              key={showing ? `${item.id}:showing` : item.id}
              onAnimationEnd={showing ? onDone : undefined}
              className={`block h-full rounded-full bg-white ${fill}`}
              style={
                showing && moving
                  ? {
                      animationDuration: `${STORY_SHOW_MS}ms`,
                      animationPlayState: playing ? 'running' : 'paused',
                    }
                  : undefined
              }
            />
          </span>
        );
      })}
    </div>
  );
}

/** A bar's fill: full behind, filling (or full, without motion) now, empty ahead. */
function fillOf(place: number, at: number, moving: boolean): string {
  if (place < at) return 'w-full';
  if (place > at) return 'w-0';
  return moving ? 'story-progress w-full' : 'w-full';
}

/**
 * Delete (yours) or take down (someone else's), asked once more first: a
 * story taken down cannot be put back. Keyed by story, so the next one
 * starts unasked.
 */
function RemoveButton({
  mine,
  pending,
  storyId,
  onRemove,
}: {
  mine: boolean;
  pending: boolean;
  storyId: string;
  onRemove: (storyId: string) => void;
}) {
  const [asked, setAsked] = useState<string | null>(null);
  const asking = asked === storyId;
  const label = mine ? (asking ? 'Delete it?' : 'Delete') : asking ? 'Take it down?' : 'Take down';
  return (
    <button
      type="button"
      onClick={() => (asking ? onRemove(storyId) : setAsked(storyId))}
      disabled={pending}
      className={`${CHROME} ${asking ? 'bg-white/15 text-white' : ''}`}
    >
      {label}
    </button>
  );
}

/** Whose, how long ago, and what you may do: take it down, pause, close. */
function ViewerHeader({
  workspaceId,
  titleId,
  story,
  author,
  mine,
  role,
  paused,
  onPause,
  onClose,
}: {
  workspaceId: string;
  titleId: string;
  story: Story;
  author: Member | undefined;
  mine: boolean;
  role: Role | undefined;
  paused: boolean;
  onPause: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (storyId: string) =>
      call(contracts['stories.delete'], { params: { workspaceId, storyId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: storiesKey(workspaceId) }),
  });
  const name = author?.name ?? 'Someone';
  const mayRemove = role !== undefined && can(role, mine ? 'story:delete_own' : 'story:delete_any');

  return (
    <>
      <div className="mt-3 flex items-center gap-2.5">
        <Avatar name={name} seed={story.authorId} avatar={author?.avatar ?? null} size="md" />
        <div className="min-w-0 flex-1 leading-tight">
          <h2 id={titleId} className="truncate text-sm font-semibold">
            {mine ? 'Your story' : name}
          </h2>
          <p className="text-xs text-white/70">{ageOf(story.createdAt, Date.now())}</p>
        </div>
        {mayRemove ? (
          <RemoveButton
            mine={mine}
            pending={remove.isPending}
            storyId={story.id}
            onRemove={remove.mutate}
          />
        ) : null}
        <button type="button" onClick={onPause} className={CHROME}>
          {paused ? 'Play' : 'Pause'}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close stories"
          className={`${CHROME} grid h-8 w-8 place-items-center px-0 text-lg leading-none`}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div aria-live="polite">
        {remove.error ? (
          <p className="mt-2 text-xs text-red-200">
            {remove.error instanceof ApiError ? remove.error.message : 'That did not work.'}
          </p>
        ) : null}
      </div>
    </>
  );
}

/** The story itself: the photo, fitted, or the words on their colour. */
function StoryFrame({ story, by }: { story: Story; by: string }) {
  if (story.kind === 'photo' && story.url) {
    return (
      // A plain img: the bytes come with the session cookie, members only.
      // biome-ignore lint/performance/noImgElement: see above
      <img
        src={`${BASE_URL}${story.url}`}
        alt={`Shared by ${by}`}
        width={story.width ?? undefined}
        height={story.height ?? undefined}
        decoding="async"
        className="h-full w-full object-contain"
      />
    );
  }
  return (
    <div
      className="grid h-full w-full place-items-center px-8"
      style={{ backgroundImage: TONE_BACKGROUNDS[story.tone ?? 'ink'] }}
    >
      <div className="flex flex-col items-center gap-6">
        {story.tryPath ? (
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/70">
            A different shot
          </p>
        ) : null}
        <p className="max-w-[22ch] whitespace-pre-wrap break-words text-center text-2xl font-semibold leading-snug tracking-tight text-white [text-wrap:balance] sm:text-3xl">
          {story.body}
        </p>
        {story.tryPath && story.tryLabel ? (
          // Above the tap zones, so it is a button rather than "next".
          <Link
            href={story.tryPath}
            className="relative z-30 rounded-full bg-white px-5 py-2 text-sm font-semibold text-black shadow-lg transition-transform hover:scale-[1.03] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            {story.tryLabel}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
