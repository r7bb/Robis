'use client';

import { useEffect, useState } from 'react';

/**
 * A value, but only once it has stopped changing for `delayMs`.
 *
 * The composer's hints run while somebody is mid-sentence. Asking about a
 * half-written word is both wasted and distracting, so they wait for the
 * typing to pause. Shared by the duplicate and priority hints, which used
 * to carry a copy each.
 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
