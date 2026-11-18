'use client';

import { Kbd, useModKey } from '../../components/ui/kbd.tsx';
import { useOpenPalette } from './command-provider.tsx';

/** The palette's shortcut, shown where people look for search, and a way in by pointer. */
export function PaletteButton({ className = '' }: { className?: string }) {
  const open = useOpenPalette();
  const mod = useModKey();
  if (!open) return null;
  return (
    <button
      type="button"
      onClick={open}
      aria-label="Open the command palette"
      title={`Command palette (${mod} K)`}
      className={`flex items-center gap-0.5 rounded px-1 py-0.5 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${className}`}
    >
      <Kbd>{mod}</Kbd>
      <Kbd>K</Kbd>
    </button>
  );
}
