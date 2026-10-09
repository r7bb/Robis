'use client';

import { type CSSProperties, Fragment, type ReactNode } from 'react';
import { useInView } from './use-scroll.ts';

/**
 * The page after the hero, in the hero's own language.
 *
 * The sections below the name used to switch to a different site: centred
 * headlines over alternating grey bands, a rainbow of label colours, small
 * text in a grid. Each one was fine; together they read as a template, and
 * the page lost the voice its first screens set up.
 *
 * So every section is now a chapter on the same near-black, on the same
 * 1400px grid as the hero, separated by one hairline rule rather than a
 * change of background. Headings are left-aligned and set large, and they
 * arrive a word at a time, the way the name's letters do.
 */

export const CHAPTER_BG = 'bg-[#08090c]';

/** Same width and gutters as the hero, so every edge lines up down the page. */
export const CHAPTER_FRAME = 'mx-auto w-full max-w-[1400px] px-[clamp(1rem,3vw,2.5rem)]';

export function Chapter({
  children,
  className = '',
  ruled = true,
}: {
  children: ReactNode;
  className?: string;
  /** The hairline above the chapter. Off where a section supplies its own. */
  ruled?: boolean;
}) {
  return (
    <section className={`${CHAPTER_BG} ${className}`}>
      <div className={CHAPTER_FRAME}>
        <div className={`py-[clamp(4.5rem,12vh,9rem)] ${ruled ? 'border-t border-white/10' : ''}`}>
          {children}
        </div>
      </div>
    </section>
  );
}

/**
 * A chapter heading that sets itself a word at a time.
 *
 * The words are real text in one `h2`, so a screen reader hears one heading
 * and search sees one string; the per-word spans exist only to carry the
 * stagger. Under reduced motion they are simply there (see
 * `[data-words]` in `globals.css`).
 */
export function ChapterTitle({
  children,
  aside,
  className = '',
}: {
  children: string;
  /** One short paragraph, stacked under the heading. */
  aside?: ReactNode;
  className?: string;
}) {
  const [ref, shown] = useInView<HTMLDivElement>();
  const words = children.split(' ');

  return (
    <div ref={ref} className={`max-w-3xl ${className}`}>
      <h2
        data-words=""
        data-shown={shown}
        className="text-balance text-[clamp(2.25rem,4.6vw,4.25rem)] font-semibold leading-[1.04] tracking-[-0.04em] text-content"
      >
        {words.map((word, index) => (
          // The space sits between the spans, not inside them, so the line
          // breaks and `text-balance` see ordinary word spacing.
          // biome-ignore lint/suspicious/noArrayIndexKey: a heading's words are static and positional; the same word may appear twice.
          <Fragment key={index}>
            <span data-word="" style={{ '--word-index': index } as CSSProperties}>
              {word}
            </span>
            {index < words.length - 1 ? ' ' : null}
          </Fragment>
        ))}
      </h2>

      {aside ? (
        <p
          data-reveal=""
          data-shown={shown}
          style={{ '--reveal-delay': `${words.length * 60 + 80}ms` } as CSSProperties}
          className="mt-5 max-w-[46ch] text-pretty text-[clamp(1.02rem,1.3vw,1.2rem)] leading-relaxed text-muted"
        >
          {aside}
        </p>
      ) : null}
    </div>
  );
}
