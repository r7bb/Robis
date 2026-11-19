'use client';

import { type RefObject, useEffect, useRef } from 'react';

/**
 * What a panel shown over the page needs while it is open (the phone's
 * menu drawer, the chat over a narrow board): focus moves into it and
 * stays there, Escape closes it, the page behind does not scroll, and on
 * closing focus goes back where it came from.
 *
 * `returnFocus` names where focus goes when the opener itself is gone, as
 * the top bar's Chat button is while the chat is open.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, summary, [tabindex]:not([tabindex="-1"])';

/** Folded away inside a closed `<details>`, other than its own summary. */
function folded(element: HTMLElement): boolean {
  const closed = element.closest('details:not([open])');
  return closed !== null && element.closest('summary')?.parentElement !== closed;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) =>
      (element.offsetParent !== null && !folded(element)) || element === document.activeElement,
  );
}

/** Tab and Shift Tab go round the panel rather than out of it. */
function keepTabInside(event: KeyboardEvent, root: HTMLElement) {
  const items = focusables(root);
  if (items.length === 0) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function useOverlay({
  active,
  onClose,
  panel,
  returnFocus,
}: {
  active: boolean;
  onClose: () => void;
  panel: RefObject<HTMLElement | null>;
  returnFocus?: () => HTMLElement | null;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  const fallback = useRef(returnFocus);
  fallback.current = returnFocus;

  useEffect(() => {
    if (!active) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = panel.current;
    if (root && !root.contains(document.activeElement)) focusables(root)[0]?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
      } else if (event.key === 'Tab' && panel.current) {
        keepTabInside(event, panel.current);
      }
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      // After the panel has gone and whatever replaces it is drawn.
      requestAnimationFrame(() => {
        // The opener, if it had focus and is still there; a click does not
        // always focus a button (Safari), which would leave only the page.
        const usable = opener && opener !== document.body && opener.isConnected;
        const target = usable ? opener : (fallback.current?.() ?? null);
        target?.focus();
      });
    };
  }, [active, panel]);
}
