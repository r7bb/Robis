import type { CSSProperties } from 'react';

/**
 * The name, set edge to edge, with each letter standing for something.
 *
 * Five letters sized in container-query units and spread with
 * `justify-between`, so the word spans its column at every width without a
 * font size guessed per breakpoint or measured in JavaScript.
 *
 * Each letter is a button. Hover alone meant nothing on a phone and nothing
 * to a keyboard, so a letter is something you can press: it jumps the page
 * to that letter's step, where the word it stands for appears and the field
 * behind takes its formation. While a step is active its letter stays lit,
 * the others dim, and a bar grows under it.
 *
 * The motion is CSS (see `[data-wordmark]` in `globals.css`): a staggered
 * rise on arrival, a lift under the pointer, and the dim and the bar between
 * steps. All of it is off under `prefers-reduced-motion`.
 */

export function Wordmark({
  letters,
  active,
  onSelect,
  className = '',
}: {
  letters: readonly { letter: string; word: string }[];
  /** Index of the lit letter, or null when none is. */
  active: number | null;
  onSelect: (index: number) => void;
  className?: string;
}) {
  return (
    <div className={`[container-type:inline-size] ${className}`}>
      {/* A fieldset because it groups buttons; `min-w-0` because a
          fieldset's default minimum is its content's width, which would stop
          the letters shrinking with a narrow screen. */}
      <fieldset
        data-wordmark=""
        data-has-active={active !== null}
        className="flex min-w-0 select-none justify-between text-[19cqw] font-extrabold sm:text-[17cqw] leading-[0.78] tracking-[-0.02em] text-content"
      >
        <legend className="sr-only">Robis, letter by letter</legend>
        {letters.map(({ letter, word }, index) => (
          <button
            key={letter}
            type="button"
            data-letter=""
            data-active={index === active}
            aria-label={`${letter}, ${word}`}
            aria-pressed={index === active}
            onClick={() => onSelect(index)}
            style={{ '--letter-index': index } as CSSProperties}
            // The padding, cancelled by the negative margin, gives the focus
            // ring room: the tight line height makes the box shorter than
            // the glyph, and the ring would otherwise cut through it.
            className="relative -my-[0.08em] rounded-md py-[0.08em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-4 focus-visible:ring-offset-[#08090c]"
          >
            {letter}
            <span aria-hidden="true" data-letter-bar="" />
          </button>
        ))}
      </fieldset>
    </div>
  );
}
