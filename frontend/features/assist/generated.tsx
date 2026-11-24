'use client';

import type { ReactNode } from 'react';

/**
 * Anything assistance made (D3), in one frame that says so: generated, to
 * check before using. Its buttons are the only way anything it says is saved.
 */
export function Generated({
  title,
  children,
  onClose,
  actions,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="mt-3 rounded-xl border border-accent/30 bg-accent/[0.06] p-4"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-content">{title}</h3>
        <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent-soft">
          Generated, check before using
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title}`}
          className="ml-auto grid h-6 w-6 place-items-center rounded-full text-faint hover:bg-surface hover:text-content"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="mt-2 text-sm text-content">{children}</div>
      {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
    </section>
  );
}
