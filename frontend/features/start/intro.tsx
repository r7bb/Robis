'use client';

import Link from 'next/link';
import { type PointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  clampSlide,
  type ScrollRoom,
  SIGN_UP_HREF,
  SLIDES,
  type SlideId,
  type Step,
  stepForKey,
  swipeStep,
  WheelGesture,
} from './deck.ts';
import { SlideBody } from './slides.tsx';
import { Threads, type ThreadsTint } from './threads.tsx';

/**
 * The "Get started" intro: six slides between the landing page and the
 * sign-up form.
 *
 * Its own place rather than the landing page again: a loom of slow threads
 * behind everything, tinted for each slide and dimmed while the tunnel has
 * no signal, under the page's one easing curve. Every slide is rendered and
 * stacked, so moving
 * between them is a real cross-motion rather than a remount; the inactive
 * ones are inert, so they take no focus and say nothing to a screen reader.
 *
 * Follows the WAI-ARIA carousel pattern with a slide picker: the picker is
 * a tablist, each slide a tabpanel, nothing advances on its own, and a live
 * region says where you are. Keys, touch swipes, two-finger trackpad swipes,
 * the mouse wheel and the buttons all move it; the keys are ignored while
 * you are typing.
 */

/** The threads' colour on each slide: the accent's family, amber underground. */
const TINTS: Record<SlideId, ThreadsTint> = {
  hello: [129, 140, 248],
  plans: [165, 180, 252],
  desk: [125, 160, 250],
  team: [180, 170, 250],
  tunnel: [251, 191, 36],
  start: [129, 140, 248],
};

/** Lines and pages, as some mice and browsers report them, in pixels. */
const LINE_PX = 16;

function wheelPixels(event: WheelEvent, page: number): { dx: number; dy: number } {
  const unit =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? LINE_PX
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? page
        : 1;
  return { dx: event.deltaX * unit, dy: event.deltaY * unit };
}

/** Whether the slide on screen can still scroll, so a wheel scrolls it first. */
function roomIn(panel: HTMLElement | null): ScrollRoom {
  if (!panel) return { canScrollDown: false, canScrollUp: false };
  return {
    canScrollDown: panel.scrollTop + panel.clientHeight < panel.scrollHeight - 1,
    canScrollUp: panel.scrollTop > 0,
  };
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
  const [online, setOnline] = useState(true);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const carousel = useRef<HTMLElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);

  const go = useCallback(
    (next: number) => {
      const target = clampSlide(next);
      if (target !== index) setIndex(target);
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
  // inside it. Hand focus to the new slide rather than leave it on the page;
  // only on a turn, so arriving leaves focus at the top like any page.
  const shown = useRef(index);
  useEffect(() => {
    if (shown.current === index) return;
    shown.current = index;
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

  // Trackpad swipes and the wheel. Attached by hand, not through React,
  // because it must not be passive: a sideways swipe has to be kept from
  // also sending the browser back a page.
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  useEffect(() => {
    const element = carousel.current;
    if (!element) return;
    const gesture = new WheelGesture();
    function onWheel(event: WheelEvent) {
      // A pinch on a trackpad arrives as a wheel with ctrl held: that is zoom.
      if (event.ctrlKey || !element) return;
      const { dx, dy } = wheelPixels(event, element.clientHeight);
      if (Math.abs(dx) > Math.abs(dy)) event.preventDefault();
      const panel = element.querySelector<HTMLElement>('[data-intro-slide][data-place="here"]');
      const by = gesture.feed(dx, dy, event.timeStamp, roomIn(panel));
      if (by !== 0) stepRef.current(by);
    }
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

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

  /** Back on the second slide hides itself; focus goes on to Next. */
  function onBack() {
    const target = clampSlide(index - 1);
    go(target);
    if (target === 0) requestAnimationFrame(() => nextButton.current?.focus());
  }

  const slide = SLIDES[index]!;
  const last = index === SLIDES.length - 1;

  return (
    <section className="relative isolate flex min-h-[100dvh] flex-col overflow-hidden bg-[#08090c] text-content">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
        <Threads tint={TINTS[slide.id]} calm={!online} />
        {/* A fade at the top and bottom, and a little shade behind the text
            column, so the words stay readable over the brightest threads. */}
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgb(8_9_12/0.55),transparent_28%,transparent_78%,#08090c)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgb(8_9_12/0.5),transparent_60%)]" />
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
        ref={carousel}
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
            className="absolute inset-0 overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_2px_rgb(var(--accent-soft)/0.35)]"
          >
            <div className="mx-auto flex min-h-full w-full max-w-[1400px] items-center px-[clamp(1rem,3vw,2.5rem)] py-[clamp(2rem,6vh,4rem)]">
              <SlideBody slide={item} active={i === index} onSignal={setOnline} />
            </div>
          </div>
        ))}
      </section>

      <footer className="relative z-10 mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-4 px-[clamp(1rem,3vw,2.5rem)] pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">
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
            onClick={onBack}
            // Hidden, not removed, on the first slide, so Next keeps its place.
            aria-disabled={index === 0}
            data-hidden={index === 0}
            className="rounded-full border border-white/15 px-4 py-2 text-sm text-muted transition-colors duration-[var(--micro)] ease-[var(--ease)] hover:border-white/30 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft active:scale-[0.98] data-[hidden=true]:invisible"
          >
            Back
          </button>
          {last ? null : (
            <button
              ref={nextButton}
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
