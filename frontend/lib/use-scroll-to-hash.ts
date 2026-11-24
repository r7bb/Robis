'use client';

import { useEffect, useRef } from 'react';

/** How the linked element is marked, so the eye lands on it. */
const LINKED = ['rounded-lg', 'ring-2', 'ring-accent/40', 'bg-accent/5'];

/**
 * Bring the element the address names (`#reply-…`, `#message-…`) into view
 * once the list holding it has loaded. The browser tries on arrival, before
 * the list exists, so a link from search or the inbox would otherwise open
 * at the top. Once per address, so reading on is never pulled back; the
 * element is marked with a soft ring, which stays until the page changes.
 */
export function useScrollToHash(ready: boolean) {
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    const hash = window.location.hash.slice(1);
    if (!hash || done.current === hash) return;
    const target = document.getElementById(decodeURIComponent(hash));
    if (!target) return;
    done.current = hash;
    target.scrollIntoView({ block: 'center' });
    target.classList.add(...LINKED);
    // Focus too, so keyboards and screen readers start where the link pointed.
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });
}
