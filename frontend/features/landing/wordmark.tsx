/**
 * The name, set edge to edge.
 *
 * Five letters sized in container-query units and spread with
 * `justify-between`, so the word spans its column at every width without a
 * font size guessed per breakpoint, and without measuring in JavaScript. It
 * was a single SVG `<text>` before, which fitted the width just as well but
 * left nothing to hold on to: each letter is its own element now, so each
 * can rise in on load and answer the cursor.
 *
 * The motion is CSS only (see `[data-wordmark]` in `globals.css`): a
 * staggered rise on arrival, a lift under the pointer, and a scroll-driven
 * shrink as it leaves the top of the screen, where the header takes over
 * the name. All of it is off under `prefers-reduced-motion`.
 *
 * Decorative to assistive technology: the header carries the name as a
 * link, and the page's heading is the proposition underneath.
 */

import type { CSSProperties } from 'react';

const LETTERS = ['R', 'O', 'B', 'I', 'S'] as const;

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <div className={`[container-type:inline-size] ${className}`}>
      <div
        data-wordmark=""
        aria-hidden="true"
        className="flex select-none justify-between text-[17cqw] font-extrabold leading-[0.78] tracking-[-0.02em] text-content"
      >
        {LETTERS.map((letter, index) => (
          <span key={letter} data-letter="" style={{ '--letter-index': index } as CSSProperties}>
            {letter}
          </span>
        ))}
      </div>
    </div>
  );
}
