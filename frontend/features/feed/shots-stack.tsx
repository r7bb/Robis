'use client';

import { useRouter } from 'next/navigation';
import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ago } from '../../components/activity-feed.tsx';
import { Avatar } from '../../components/ui/avatar.tsx';
import type { Member } from '../../lib/api.ts';
import { useStories } from '../stories/stories-context.tsx';
import { type Story, TONE_BACKGROUNDS } from '../stories/story-model.ts';
import {
  readSetAside,
  type SwipeVerdict,
  verdictOf,
  visibleShots,
  writeSetAside,
} from './shots-model.ts';

/**
 * Different shots on the feed (Phase 2c): a small stack of ideas to try.
 * Swipe right, or press Try it or the right arrow, to go and try one;
 * swipe left, Not now or the left arrow, to set it aside (with Undo, or Z);
 * tap it, See more, Enter or Space to read all of it. Every swipe has a
 * button and a key. With reduced motion cards fade rather than fly. It
 * ends: "That's all for today".
 */

/** How long Undo is offered after setting a shot aside. */
const UNDO_MS = 6000;

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

/** Shots set aside, in this browser, and a way to set one aside or take it back. */
function useSetAside(me: string | null, live: readonly Story[]) {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (me) setIds(readSetAside(me));
  }, [me]);
  const save = (next: ReadonlySet<string>) => {
    setIds(next);
    if (me) writeSetAside(me, next, live);
  };
  return {
    ids,
    add: (id: string) => save(new Set([...ids, id])),
    remove: (id: string) => save(new Set([...ids].filter((kept) => kept !== id))),
  };
}

export function ShotsStack({ people }: { people: ReadonlyMap<string, Member> }) {
  const stories = useStories();
  const router = useRouter();
  const reduced = useReducedMotion();
  const live = useMemo(() => [...(stories?.grouped.values() ?? [])].flat(), [stories?.grouped]);
  const aside = useSetAside(stories?.me ?? null, live);
  const shots = visibleShots(live, aside.ids);
  const anyToday = live.some((story) => story.tryPath !== null);
  const [expanded, setExpanded] = useState(false);
  const [undo, setUndo] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<'left' | 'right' | null>(null);
  const top = shots[0];

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  if (!stories?.enabled || !anyToday) return null;

  /** Act on the top card, after its leaving animation when motion is welcome. */
  function act(verdict: SwipeVerdict) {
    if (!top) return;
    if (verdict === 'tap') return setExpanded((was) => !was);
    if (verdict === 'stay') return;
    const shot = top;
    setLeaving(verdict === 'try' ? 'right' : 'left');
    window.setTimeout(
      () => {
        setLeaving(null);
        setExpanded(false);
        aside.add(shot.id);
        if (verdict === 'try' && shot.tryPath) router.push(shot.tryPath);
        else setUndo(shot.id);
      },
      reduced ? 0 : 220,
    );
  }

  /**
   * Keys while any of the stack's buttons has focus: the arrows swipe and Z
   * takes back a Not now. Enter and Space stay the focused button's own.
   */
  function onKeyDown(event: KeyboardEvent<HTMLFieldSetElement>) {
    const verdict: Record<string, SwipeVerdict> = { ArrowRight: 'try', ArrowLeft: 'not-now' };
    if (event.key === 'z' && undo) {
      aside.remove(undo);
      setUndo(null);
    } else if (verdict[event.key]) act(verdict[event.key]!);
    else return;
    event.preventDefault();
  }

  return (
    <section aria-labelledby="shots-heading" className="mt-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="shots-heading" className="text-xs font-medium uppercase tracking-wide text-faint">
          Different shots
        </h2>
        <p className="text-[11px] text-faint">
          Swipe the card, or use the buttons (arrow keys too)
        </p>
      </div>
      {top ? (
        <fieldset onKeyDown={onKeyDown} className="relative mt-3 min-w-0 border-0 p-0">
          <legend className="sr-only">{`Different shots, ${shots.length} to try`}</legend>
          <div className="relative h-56">
            {shots
              .slice(0, 3)
              .reverse()
              .map((shot, back) => {
                const depth = Math.min(shots.length, 3) - 1 - back;
                return depth === 0 ? (
                  <TopCard
                    key={shot.id}
                    shot={shot}
                    author={people.get(shot.authorId)}
                    expanded={expanded}
                    leaving={leaving}
                    reduced={reduced}
                    onVerdict={act}
                  />
                ) : (
                  <span
                    key={shot.id}
                    aria-hidden="true"
                    className="absolute inset-x-0 top-0 h-56 rounded-2xl border border-line opacity-60"
                    style={{
                      backgroundImage: TONE_BACKGROUNDS[shot.tone ?? 'ink'],
                      transform: `translateY(${depth * 10}px) scale(${1 - depth * 0.04})`,
                    }}
                  />
                );
              })}
          </div>
          <div className="mt-6 flex items-center justify-between gap-2">
            <button type="button" onClick={() => act('not-now')} className={BUTTON}>
              Not now
            </button>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => act('tap')}
              className={BUTTON}
            >
              {expanded ? 'Show less' : 'See more'}
            </button>
            <button
              type="button"
              onClick={() => act('try')}
              className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-accent-contrast transition-[background-color,transform] hover:bg-accent-hover active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {top.tryLabel ?? 'Try it'}
            </button>
          </div>
          <p className="sr-only" aria-live="polite">
            {top.body}
          </p>
        </fieldset>
      ) : (
        <p className="mt-3 rounded-2xl border border-dashed border-line px-6 py-6 text-center text-sm text-faint">
          That’s all for today. A new idea comes tomorrow.
        </p>
      )}
      <div aria-live="polite" className="mt-2 min-h-5 text-center">
        {undo ? (
          <button
            type="button"
            onClick={() => {
              aside.remove(undo);
              setUndo(null);
            }}
            className="rounded px-2 py-0.5 text-xs text-muted underline-offset-2 hover:text-content hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
          >
            Set aside. Undo (Z)
          </button>
        ) : null}
      </div>
    </section>
  );
}

const BUTTON =
  'rounded-full border border-line px-4 py-1.5 text-sm text-muted transition-colors hover:bg-raised hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft';

/** The card on top: it follows a drag, leans as it goes, and says which way it means. */
function TopCard({
  shot,
  author,
  expanded,
  leaving,
  reduced,
  onVerdict,
}: {
  shot: Story;
  author: Member | undefined;
  expanded: boolean;
  leaving: 'left' | 'right' | null;
  reduced: boolean;
  onVerdict: (verdict: SwipeVerdict) => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    start.current = { x: event.clientX, y: event.clientY };
    setDragging(true);
    card.current?.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    setDx(event.clientX - start.current.x);
    setDy(event.clientY - start.current.y);
  }
  function onPointerUp() {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
    const verdict = verdictOf(dx, dy);
    setDx(0);
    setDy(0);
    onVerdict(verdict);
  }

  const flying = leaving === 'right' ? 520 : leaving === 'left' ? -520 : null;
  const x = flying ?? dx;
  const transform = reduced ? undefined : `translateX(${x}px) rotate(${x / 24}deg)`;
  const name = author?.name ?? 'An agent';

  return (
    <div
      ref={card}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={`absolute inset-x-0 top-0 h-56 cursor-grab touch-pan-y select-none overflow-hidden rounded-2xl border border-line shadow-xl active:cursor-grabbing ${
        dragging
          ? ''
          : 'transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-opacity'
      }`}
      style={{
        backgroundImage: TONE_BACKGROUNDS[shot.tone ?? 'ink'],
        transform,
        opacity: leaving ? 0 : 1,
      }}
    >
      <div className="flex h-full flex-col justify-between p-5">
        <div className="flex items-center gap-2">
          <Avatar name={name} seed={shot.authorId} avatar={author?.avatar ?? null} size="sm" />
          <span className="text-xs font-medium text-white/85">
            {name} · {ago(shot.createdAt)}
          </span>
        </div>
        <p
          className={`text-pretty text-lg font-semibold leading-snug text-white ${
            expanded ? '' : 'line-clamp-3'
          }`}
        >
          {shot.body}
        </p>
        <div className="flex justify-between text-[11px] font-medium uppercase tracking-wide">
          <span
            className={`text-white/80 transition-opacity ${x < -24 ? 'opacity-100' : 'opacity-0'}`}
          >
            Not now
          </span>
          <span
            className={`text-white/80 transition-opacity ${x > 24 ? 'opacity-100' : 'opacity-0'}`}
          >
            Try it
          </span>
        </div>
      </div>
    </div>
  );
}
