'use client';

import { useEffect, useRef } from 'react';

/**
 * Bring the element the address names (`#reply-…`, `#message-…`) into view
 * once the list holding it has loaded. The browser tries on arrival, before
 * the list exists, so a link from search or the inbox would otherwise open
 * at the top. Once per address, so reading on is never pulled back.
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
    // A focus ring shows where the eye should land, for keyboards and screen readers too.
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });
}
