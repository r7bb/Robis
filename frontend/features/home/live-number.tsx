'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../landing/use-scroll.ts';

/** How long a "+2" stays up after a number rises. */
const DELTA_MS = 1400;

/**
 * A number that counts to its value, and from its old value to a new one
 * whenever it changes; when it rises, a small "+n" floats off it.
 *
 * The landing's `Counter` counts up once; these numbers are live, so the
 * motion means "this just changed" rather than "look here". Under reduced
 * motion it simply shows the new value, with no float.
 */
export function LiveNumber({ value, durationMs = 700 }: { value: number; durationMs?: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  const from = useRef(reduced ? value : 0);
  // The value last arrived at; null before the first, which is not a rise.
  const settled = useRef<number | null>(null);
  const [delta, setDelta] = useState<{ n: number; key: number } | null>(null);

  useEffect(() => {
    const previous = settled.current;
    settled.current = value;
    if (previous === null || value <= previous || reduced) {
      setDelta(null);
      return;
    }
    setDelta({ n: value - previous, key: performance.now() });
    const timer = setTimeout(() => setDelta(null), DELTA_MS);
    return () => clearTimeout(timer);
  }, [value, reduced]);

  useEffect(() => {
    if (reduced) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = from.current;
    const began = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / durationMs);
      // Ease-out cubic: settles on the value instead of ticking like a timer.
      const next = Math.round(start + (value - start) * (1 - (1 - t) ** 3));
      from.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced, durationMs]);

  return (
    <span className="relative inline-block">
      {shown.toLocaleString()}
      {delta && (
        <span
          key={delta.key}
          aria-hidden="true"
          className="home-delta pointer-events-none absolute -right-1 top-0 translate-x-full text-[0.45em] font-semibold text-emerald-300"
        >
          +{delta.n}
        </span>
      )}
    </span>
  );
}
