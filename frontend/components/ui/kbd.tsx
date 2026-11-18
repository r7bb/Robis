'use client';

import { type ReactNode, useEffect, useState } from 'react';

/** A key, drawn as a keycap. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.375rem] items-center justify-center rounded border border-line bg-surface px-1 py-px font-sans text-[10px] font-medium leading-4 text-muted shadow-[0_1px_0_rgb(var(--border))]">
      {children}
    </kbd>
  );
}

/**
 * The modifier key as this keyboard names it: ⌘ on a Mac, Ctrl elsewhere.
 * Ctrl until the page has hydrated, so the server and client render alike.
 */
export function useModKey(): string {
  const [mod, setMod] = useState('Ctrl');
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.userAgent)) setMod('⌘');
  }, []);
  return mod;
}
