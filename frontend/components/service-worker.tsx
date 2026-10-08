'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker that caches the app shell -- and, when it is
 * switched off, actively removes one that was registered earlier.
 *
 * Disabled in development by default: Next's dev server serves chunks whose
 * names are stable across edits, so a cache-first worker in front of them
 * hands back yesterday's JavaScript and produces stale-module errors that
 * look like application bugs. Set `NEXT_PUBLIC_ENABLE_SW=1` to exercise it.
 *
 * The unregister path is the part that was missing, and it mattered. A
 * worker registered during one run with the flag on survives every later
 * run with the flag off, because nothing removed it: the old code simply
 * returned. The symptom is one browser pinned to a stale build while every
 * other browser sees the current one, which reads as "the page is broken
 * for me only" and is close to impossible to diagnose from outside that
 * machine. A flag that can be turned on but not off is a trap.
 */
const ENABLED = process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_ENABLE_SW === '1';

export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (ENABLED) {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        // Registration failing degrades the app to online-only, which is
        // worth a warning but not worth breaking the page over.
        console.warn('service worker registration failed', error);
      });
      return;
    }

    /*
     * Switched off: undo whatever an earlier run left behind.
     *
     * Both halves are needed. Unregistering stops the worker intercepting
     * future requests, but its caches outlive it, so anything already
     * stored would still be served by a worker registered later. Deleting
     * the caches without unregistering leaves a worker that refills them.
     */
    void (async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        if (registrations.length === 0) return;

        await Promise.all(registrations.map((registration) => registration.unregister()));

        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(
            keys.filter((key) => key.startsWith('relay-')).map((key) => caches.delete(key)),
          );
        }

        console.info('removed a service worker left over from an earlier run; reloading');

        // The page on screen was served by the worker that just went away,
        // so it is still the stale one.
        window.location.reload();
      } catch (error) {
        console.warn('could not remove the existing service worker', error);
      }
    })();
  }, []);

  return null;
}
