'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A dropdown's open state and its box: a click outside the box, or an
 * Escape nothing inside it has handled, closes it.
 */
export function useDropdown<T extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false);
  const box = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    // An Escape something inside already handled (a question closing) is left alone.
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);
  return { open, setOpen, box };
}
