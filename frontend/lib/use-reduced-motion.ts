'use client';

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether the person has asked their system for less motion, kept current
 * if they change it with the page open (C9). False on the server.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const media = window.matchMedia(QUERY);
      media.addEventListener('change', changed);
      return () => media.removeEventListener('change', changed);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
