'use client';

import { useSyncExternalStore } from 'react';

/** Whether the browser says it has a network, kept current by its online and offline events. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (changed) => {
      window.addEventListener('online', changed);
      window.addEventListener('offline', changed);
      return () => {
        window.removeEventListener('online', changed);
        window.removeEventListener('offline', changed);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}
