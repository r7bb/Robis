'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../landing/use-scroll.ts';

/**
 * A number that counts to its value, and from its old value to a new one
 * whenever it changes.
 *
 * The landing's `Counter` counts up once; these numbers are live, so the
 * motion means "this just changed" rather than "look here". Under reduced
 * motion it simply shows the new value.
 */
export function LiveNumber({ value, durationMs = 700 }: { value: number; durationMs?: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  const from = useRef(reduced ? value : 0);

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

  return <span>{shown.toLocaleString()}</span>;
}
