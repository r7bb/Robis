import Image from 'next/image';
import type { ReactNode } from 'react';

/**
 * The shared vocabulary of the public pages.
 *
 * Extracted from `sections.tsx` when `/how-it-works` needed the same
 * shapes. Keeping two copies of a band would have been the start of the
 * two pages drifting apart, which on a marketing surface reads as
 * carelessness faster than almost anything else.
 *
 * Nothing here has a fixed height. Bands grow to fit their content with
 * padding that scales, and headlines scale continuously with `clamp`, so
 * the pages render at any viewport rather than at the one they happened to
 * be designed on.
 */

/** Band backgrounds, darkest first. Adjacent bands never repeat. */
export const BANDS = {
  black: 'bg-[#08090c]',
  base: 'bg-[#0e1014]',
  raised: 'bg-[#14171d]',
} as const;

export const FILLED =
  'inline-flex items-center justify-center rounded-full bg-accent px-7 py-3 text-base font-medium text-accent-contrast transition-[background-color,transform] duration-[var(--quick)] ease-[var(--ease)] hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-4 focus-visible:ring-offset-surface active:scale-[0.98]';

export const OUTLINED =
  'inline-flex items-center justify-center rounded-full border border-accent-soft/50 px-7 py-3 text-base font-medium text-accent-soft transition-[background-color,border-color,transform] duration-[var(--quick)] ease-[var(--ease)] hover:border-accent-soft hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-4 focus-visible:ring-offset-surface active:scale-[0.98]';

export function Band({
  tone,
  children,
  className = '',
}: {
  tone: keyof typeof BANDS;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`px-6 py-[clamp(4rem,9vh,9rem)] text-center ${BANDS[tone]} ${className}`}>
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </section>
  );
}

/**
 * `clamp` rather than breakpoint steps: the size moves continuously with
 * the viewport, so there is no width at which it is awkwardly large or
 * suddenly small. `text-balance` keeps a two-line headline from leaving an
 * orphan word on the second line.
 */
export function Headline({ children }: { children: ReactNode }) {
  return (
    <h2 className="mx-auto max-w-[16ch] text-balance text-[clamp(2.25rem,5vw,4.5rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-content">
      {children}
    </h2>
  );
}

export function Subhead({ children }: { children: ReactNode }) {
  return (
    <p className="mx-auto mt-5 max-w-[46ch] text-[clamp(1.05rem,1.6vw,1.4rem)] leading-relaxed text-muted">
      {children}
    </p>
  );
}

/** A screenshot at its natural aspect ratio. */
export function Shot({
  src,
  alt,
  priority,
  className = '',
}: {
  src: string;
  alt: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <Image
      src={src}
      alt={alt}
      width={1440}
      height={900}
      priority={priority}
      sizes="(max-width: 1024px) 100vw, 1100px"
      className={`mx-auto h-auto w-full rounded-xl border border-white/10 shadow-2xl shadow-black/60 ${className}`}
    />
  );
}
