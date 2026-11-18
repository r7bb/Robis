'use client';

import type { Role } from '@robis/shared';
import { useEffect, useId, useRef } from 'react';
import { Kbd, useModKey } from '../../components/ui/kbd.tsx';
import { shortcutsFor } from '../../lib/board-keys.ts';

/**
 * The board's shortcuts (C2), on the question mark key. Lists only what this
 * role may do, from the same table the keys are read from, so the help
 * cannot promise a key that does nothing.
 */
export function ShortcutHelp({ role, onClose }: { role: Role | undefined; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const mod = useModKey();
  const shortcuts = shortcutsFor(role);

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // Only a close that left it closed: see the command palette.
      onClose={(event) => {
        if (!event.currentTarget.open) onClose();
      }}
      className="palette m-0 mx-auto mt-[10vh] max-h-[80vh] w-[min(34rem,calc(100%-2rem))] overflow-y-auto rounded-xl border border-line bg-raised p-0 text-content shadow-2xl backdrop:bg-black/55 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 id={titleId} className="text-sm font-semibold">
          Keyboard shortcuts
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-1.5 py-0.5 text-xs text-muted transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
        >
          Close
        </button>
      </div>

      <div className="grid gap-5 px-5 py-4 sm:grid-cols-2">
        {(['Cards', 'Board'] as const).map((section) => (
          <section key={section}>
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-faint">
              {section}
            </h3>
            <dl className="mt-2 space-y-2">
              {shortcuts
                .filter((s) => s.section === section)
                .map((s) => (
                  <div key={s.id} className="flex items-start justify-between gap-3 text-sm">
                    <dt className="text-muted">{s.does}</dt>
                    <dd className="flex shrink-0 gap-1">
                      {s.keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              {section === 'Board' && (
                <div className="flex items-start justify-between gap-3 text-sm">
                  <dt className="text-muted">The palette, from any page</dt>
                  <dd className="flex shrink-0 gap-1">
                    <Kbd>{mod}</Kbd>
                    <Kbd>K</Kbd>
                  </dd>
                </div>
              )}
            </dl>
          </section>
        ))}
      </div>
      <p className="border-t border-line px-5 py-2.5 text-[11px] text-faint">
        Keys rest while you type in a field, and with a dialog open.
      </p>
    </dialog>
  );
}
