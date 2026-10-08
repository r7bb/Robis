'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from './use-scroll.ts';

/**
 * The two moving parts the landing page is built from.
 *
 * Both degrade to "already finished" rather than "never starts". A reveal
 * that fails to fire must leave content visible, because invisible content
 * is a broken page and a missing animation is only a plainer one.
 */

/** Fades and lifts its children the first time they scroll into view. */
export function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  /** Milliseconds, for staggering siblings. */
  delay?: number;
  className?: string;
}) {
  const [ref, shown] = useInView<HTMLDivElement>();

  return (
    <div
      ref={ref}
      data-reveal=""
      data-shown={shown}
      style={{ '--reveal-delay': `${delay}ms` } as React.CSSProperties}
      className={className}
    >
      {children}
    </div>
  );
}

/**
 * A number that counts up once, when it is first seen.
 *
 * Motivated rather than decorative: the measured figures are the most
 * load-bearing claim on the page, and counting draws the eye to them at the
 * moment they arrive. Everything else about them is static.
 */
export function Counter({
  value,
  decimals = 0,
  suffix = '',
  durationMs = 900,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  durationMs?: number;
}) {
  const [ref, shown] = useInView<HTMLSpanElement>();
  const reduced = useReducedMotion();
  const [current, setCurrent] = useState(0);
  const frame = useRef<number>(0);

  useEffect(() => {
    if (!shown) return;

    // Nothing to animate: land on the number and stop.
    if (reduced) {
      setCurrent(value);
      return;
    }

    const started = performance.now();

    const step = (now: number) => {
      const elapsed = Math.min(1, (now - started) / durationMs);
      // Ease-out cubic. A linear count reads like a loading spinner; easing
      // makes it read as settling on a value.
      const eased = 1 - (1 - elapsed) ** 3;

      setCurrent(value * eased);
      if (elapsed < 1) frame.current = requestAnimationFrame(step);
    };

    frame.current = requestAnimationFrame(step);

    // Cancelled on unmount, so a navigation mid-count does not leave a
    // callback writing into a component that is gone.
    return () => cancelAnimationFrame(frame.current);
  }, [shown, reduced, value, durationMs]);

  return (
    <span ref={ref}>
      {current.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  );
}
