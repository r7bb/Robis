'use client';

import { type RefObject, useEffect, useRef, useState } from 'react';

/**
 * Scroll behaviour for the landing page, built on IntersectionObserver.
 *
 * Deliberately no `scroll` listener anywhere. A scroll handler runs on every
 * frame the page moves, on the main thread, and the usual fix (throttling)
 * trades jank for lag. IntersectionObserver does the same work off the main
 * thread and only calls back when something actually crosses a boundary.
 *
 * It is also why there is no animation library here. The whole page needs
 * two primitives -- "is this on screen" and "which step am I on" -- and both
 * are a dozen lines of platform API. Adding Motion or GSAP for that would be
 * a dependency, a bundle, and a second way of doing things.
 */

/** Honour the OS setting, and react if it changes mid-session. */
export function useReducedMotion(): boolean {
  // Starts false so the server and the first client render agree. A true
  // value here would be a hydration mismatch on every machine that prefers
  // reduced motion.
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);

    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);

    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/**
 * True once the element has been scrolled into view, and true forever after.
 *
 * One-way on purpose: content that fades out again when you scroll back up
 * is a page fighting its reader. Disconnecting after the first hit also
 * means the observer costs nothing for the rest of the session.
 */
export function useInView<T extends HTMLElement>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // No IntersectionObserver (very old browsers, some test runners) means
    // show everything rather than show nothing.
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;

        setShown(true);
        observer.disconnect();
      },
      // A little inside the viewport, so a reveal finishes as the element
      // settles rather than starting the moment its first pixel appears.
      { rootMargin: '0px 0px -12% 0px', threshold: 0.15 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, shown];
}

/**
 * Which step of a sticky sequence is currently being read.
 *
 * The pattern: a tall container, a `position: sticky` stage that stays put,
 * and one spacer per step scrolling past behind it. Each spacer is observed,
 * and whichever is crossing the middle of the viewport is the active step.
 *
 * Discrete steps rather than a continuous 0-to-1 progress value. Continuous
 * progress needs the scroll position on every frame; this needs a callback
 * only when the reader crosses from one step into the next, and the
 * cross-fade between them is a CSS transition the compositor owns.
 */
export function useActiveStep(count: number): [RefObject<HTMLDivElement | null>[], number] {
  // Refs are created once and kept, so the array identity is stable across
  // renders and the effect below does not re-subscribe on every paint.
  const refs = useRef<RefObject<HTMLDivElement | null>[]>([]);
  if (refs.current.length !== count) {
    refs.current = Array.from({ length: count }, (_, i) => refs.current[i] ?? { current: null });
  }

  const [active, setActive] = useState(0);

  useEffect(() => {
    const elements = refs.current.map((ref) => ref.current).filter((el) => el !== null);
    if (elements.length === 0 || typeof IntersectionObserver === 'undefined') return;

    const indexOf = new Map(elements.map((element, index) => [element, index]));

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;

          const index = indexOf.get(entry.target as HTMLDivElement);
          if (index !== undefined) setActive(index);
        }
      },
      /*
       * A one-pixel band across the middle of the viewport. Collapsing the
       * root to a line means exactly one spacer can intersect at a time, so
       * there is never an ambiguous moment where two steps both claim to be
       * active and the stage flickers between them.
       */
      { rootMargin: '-50% 0px -50% 0px', threshold: 0 },
    );

    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [refs.current, active];
}
