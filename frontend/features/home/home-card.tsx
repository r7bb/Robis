import type { ReactNode } from 'react';

/**
 * The frame of each Today card on the home: a title, and a body that
 * scrolls inside the card when the home sits on one screen.
 */
export function HomeCard({
  id,
  title,
  aside,
  children,
}: {
  id: string;
  title: string;
  /** Beside the title: a count, a link. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="min-w-0 rounded-2xl border border-line bg-raised p-5 shadow-[0_12px_40px_rgb(8_9_12/0.45)] fit:flex fit:min-h-0 fit:flex-col"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={id} className="text-sm font-semibold text-content">
          {title}
        </h2>
        {aside}
      </div>
      <div className="mt-3 fit:min-h-0 fit:flex-1 fit:overflow-y-auto fit:overscroll-contain">
        {children}
      </div>
    </section>
  );
}

/** Three grey rows while a card's list is on its way. */
export function CardLoading() {
  return (
    <div aria-hidden="true" className="space-y-2">
      {[0, 1, 2].map((n) => (
        <div key={n} className="h-9 animate-pulse rounded-lg bg-surface/70" />
      ))}
    </div>
  );
}
