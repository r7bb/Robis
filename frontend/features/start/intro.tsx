'use client';

import Link from 'next/link';
import { type PointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Field } from '../landing/field.tsx';
import type { FieldMode } from '../landing/field-modes.ts';
import {
  clampSlide,
  SIGN_UP_HREF,
  SLIDES,
  type SlideId,
  type Step,
  stepForKey,
  swipeStep,
} from './deck.ts';
import { SlideBody } from './slides.tsx';

/**
 * The "Get started" intro: five slides between the landing page and the
 * sign-up form.
 *
 * Built on the landing page's own parts, so it reads as the same place: the
 * WebGL field behind everything, changing formation for each slide, and the
 * page's one easing curve. Every slide is rendered and stacked, so moving
 * between them is a real cross-motion rather than a remount; the inactive
 * ones are inert, so they take no focus and say nothing to a screen reader.
 *
 * Follows the WAI-ARIA carousel pattern with a slide picker: the picker is
 * a tablist, each slide a tabpanel, nothing advances on its own, and a live
 * region says where you are. Keys, swipes and the buttons all move it; the
 * keys are ignored while you are typing in one of the demos.
 */

/** The field's formation for each slide, the way the hero's letters set it. */
function fieldModeFor(id: SlideId, offline: boolean): FieldMode {
  switch (id) {
    case 'offline':
      return offline ? 'offline' : 'merge';
    case 'record':
      return 'once';
    case 'needs':
      return 'board';
    case 'start':
      return 'realtime';
    default:
      return 'idle';
  }
}

/** Typing in a demo must never turn the slide. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

/** A drag that starts on something to press is a press, not a swipe. */
function isControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('button, a, input, textarea, select, [contenteditable="true"]'));
}

export function Intro() {
  const [index, setIndex] = useState(0);
  // A slide's heavy content (the live editors) mounts on first visit and
  // then stays, so coming back finds it as it was left.
  const [visited, setVisited] = useState<ReadonlySet<number>>(() => new Set([0]));
  const [offline, setOffline] = useState(false);
  const [pulse, setPulse] = useState(0);
  const lastKeystroke = useRef(Number.NEGATIVE_INFINITY);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const go = useCallback(
    (next: number) => {
      const target = clampSlide(next);
      if (target === index) return;
      setIndex(target);
      // One ring out across the field for every turn of the deck.
      setPulse((count) => count + 1);
      setVisited((seen) => (seen.has(target) ? seen : new Set([...seen, target])));
    },
    [index],
  );

  const step = useCallback(
    (by: Step) => {
      if (by === 'first') go(0);
      else if (by === 'last') go(SLIDES.length - 1);
      else go(index + by);
    },
    [go, index],
  );

  // Turning the deck makes the old slide inert, which blurs anything focused
  // inside it. Hand focus to the new slide rather than leave it on the page.
  useEffect(() => {
    const active = document.activeElement;
    if (active && active !== document.body && !active.closest('[inert]')) return;
    document.getElementById(`intro-slide-${SLIDES[index]!.id}`)?.focus({ preventScroll: true });
  }, [index]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (isTyping(event.target)) return;
      // Only the arrows turn the deck from anywhere. Space, Page Up and Down,
      // Home and End keep scrolling a slide that is taller than the screen;
      // the picker answers them when it has focus.
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const by = stepForKey(event.key);
      if (by === null) return;
      event.preventDefault();
      step(by);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  function onPointerDown(event: PointerEvent) {
    // Touch and pen only: a mouse drag across a slide is someone selecting
    // its text, not turning it.
    const swipeable = event.pointerType === 'touch' || event.pointerType === 'pen';
    drag.current =
      swipeable && !isControl(event.target) ? { x: event.clientX, y: event.clientY } : null;
  }

  function onPointerCancel() {
    drag.current = null;
  }

  function onPointerUp(event: PointerEvent) {
    const start = drag.current;
    drag.current = null;
    if (!start || window.getSelection()?.toString()) return;
    const by = swipeStep(event.clientX - start.x, event.clientY - start.y);
    if (by !== 0) step(by);
  }

  /** Arrow keys inside the picker move between its tabs, as the pattern asks. */
  /** Inside the picker every deck key works, and focus follows the tab. */
  function onPickerKey(event: React.KeyboardEvent) {
    const by = event.key === ' ' ? null : stepForKey(event.key);
    if (by === null) return;
    event.preventDefault();
    event.stopPropagation();
    const next = by === 'first' ? 0 : by === 'last' ? SLIDES.length - 1 : clampSlide(index + by);
    go(next);
    tabs.current[next]?.focus();
  }

  /**
   * Next on the second-to-last slide removes itself, so focus is handed to
   * the slide's primary action instead of falling back to the page.
   */
  function onNext() {
    const target = clampSlide(index + 1);
    go(target);
    if (target === SLIDES.length - 1) {
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('[data-intro-primary]')?.focus();
      });
    }
  }

  const slide = SLIDES[index]!;
  const last = index === SLIDES.length - 1;

  return (
    // A <section>, because the field follows the pointer across its nearest
    // section ancestor, and draws nothing without one.
    <section className="relative isolate flex min-h-[100dvh] flex-col overflow-hidden bg-[#08090c] text-content">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
        <Field mode={fieldModeFor(slide.id, offline)} pulse={pulse} activityAt={lastKeystroke} />
        {/* The hero's own fade at the top and bottom, and a little shade
            behind the text column, so the field stays the picture. */}
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgb(8_9_12/0.6),transparent_30%,transparent_80%,#08090c)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgb(8_9_12/0.55),transparent_55%)]" />
      </div>

      <header className="relative z-10 mx-auto flex w-full max-w-[1400px] items-center justify-between px-[clamp(1rem,3vw,2.5rem)] pt-5">
        <Link
          href="/"
          translate="no"
          className="text-lg font-semibold tracking-[-0.03em] text-content transition-opacity duration-[var(--micro)] ease-[var(--ease)] hover:opacity-80"
        >
          Robis
        </Link>
        <Link
          href={SIGN_UP_HREF}
          className="rounded-full px-3 py-1.5 text-sm text-muted transition-colors duration-[var(--micro)] ease-[var(--ease)] hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
        >
          Skip to sign up
        </Link>
      </header>

      {/* Progress: decorative, so it is hidden; the live region says it. */}
      <div
        aria-hidden="true"
        className="relative z-10 mx-auto mt-4 w-full max-w-[1400px] px-[clamp(1rem,3vw,2.5rem)]"
      >
        <div className="h-px w-full overflow-hidden bg-white/10">
          <div
            data-intro-progress=""
            className="h-full origin-left bg-accent"
            style={{ transform: `scaleX(${(index + 1) / SLIDES.length})` }}
          />
        </div>
      </div>

      <section
        aria-roledescription="carousel"
        aria-label="How Robis works"
        className="relative z-10 flex flex-1 [touch-action:pan-y_pinch-zoom]"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <p aria-live="polite" className="sr-only">
          {`Slide ${index + 1} of ${SLIDES.length}: ${slide.label}`}
        </p>

        {SLIDES.map((item, i) => (
          <div
            key={item.id}
            id={`intro-slide-${item.id}`}
            role="tabpanel"
            aria-labelledby={`intro-tab-${item.id}`}
            tabIndex={i === index ? 0 : -1}
            data-intro-slide=""
            data-place={i === index ? 'here' : i < index ? 'before' : 'after'}
            inert={i !== index}
            className="absolute inset-0 overflow-y-auto overscroll-contain focus-visible:outline-none"
          >
            <div className="mx-auto flex min-h-full w-full max-w-[1400px] items-center px-[clamp(1rem,3vw,2.5rem)] py-[clamp(2rem,6vh,4rem)]">
              <SlideBody
                slide={item}
                active={i === index}
                mounted={visited.has(i)}
                onNetwork={({ online, merged }) => {
                  setOffline(!online);
                  if (online && merged > 0) setPulse((count) => count + 1);
                }}
                onActivity={() => {
                  lastKeystroke.current = performance.now();
                }}
              />
            </div>
          </div>
        ))}
      </section>

      <footer className="relative z-10 mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-4 px-[clamp(1rem,3vw,2.5rem)] pb-6 pt-2">
        <div
          role="tablist"
          aria-label="Choose a slide"
          className="flex items-center"
          onKeyDown={onPickerKey}
        >
          {SLIDES.map((item, i) => (
            <button
              key={item.id}
              ref={(element) => {
                tabs.current[i] = element;
              }}
              id={`intro-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-controls={`intro-slide-${item.id}`}
              tabIndex={i === index ? 0 : -1}
              title={item.label}
              onClick={() => go(i)}
              className="group grid h-11 min-w-8 place-items-center rounded-full px-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
            >
              <span className="sr-only">{item.label}</span>
              <span
                aria-hidden="true"
                data-intro-dot=""
                data-current={i === index}
                className="block h-1.5 rounded-full bg-white/40 group-hover:bg-white/60 data-[current=true]:bg-accent"
              />
            </button>
          ))}
          <span aria-hidden="true" className="ml-2 font-mono text-xs tabular-nums text-faint">
            {index + 1}/{SLIDES.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => step(-1)}
            // aria-disabled rather than disabled: a disabled button drops
            // focus on the floor when it is the one that has it.
            aria-disabled={index === 0}
            data-hidden={index === 0}
            className="rounded-full border border-white/15 px-4 py-2 text-sm text-muted transition-colors duration-[var(--micro)] ease-[var(--ease)] hover:border-white/30 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft active:scale-[0.98] data-[hidden=true]:pointer-events-none data-[hidden=true]:opacity-0"
          >
            Back
          </button>
          {last ? null : (
            <button
              type="button"
              onClick={onNext}
              className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-accent-contrast transition-colors duration-[var(--micro)] ease-[var(--ease)] hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft active:scale-[0.98]"
            >
              Next
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}
