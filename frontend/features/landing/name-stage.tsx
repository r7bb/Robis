'use client';

import { useEffect, useRef, useState } from 'react';
import { useActiveStep, useReducedMotion } from './use-scroll.ts';
import { Wordmark } from './wordmark.tsx';

/**
 * The first screens: the name, and what each of its letters stands for.
 *
 * Borrowed from the way the best-awarded sites stage a single object and let
 * scrolling build its meaning, rather than putting a headline and a feature
 * grid on the first screen. Here the object is the word itself. It stays
 * pinned while the page scrolls under it, and each letter takes a turn: it
 * lights, the word it stands for appears beneath, and the field behind
 * takes that letter's formation (see `field-modes.ts`).
 *
 * Every line is something the product actually does. The 5.8 ms is the
 * measured p50 from the load harness, not a round number.
 */

export const LETTERS = [
  {
    letter: 'R',
    word: 'Realtime',
    line: 'A change reaches 50 open boards in 5.8 ms. Measured, not estimated.',
  },
  {
    letter: 'O',
    word: 'Offline',
    line: 'Pull the network mid-sentence. Every write waits on your device.',
  },
  {
    letter: 'B',
    word: 'Boards',
    line: 'Issues, documents, chat and meetings, in one workspace.',
  },
  {
    letter: 'I',
    word: 'Idempotent',
    line: 'Retry anything. A client id makes sure it lands exactly once.',
  },
  {
    letter: 'S',
    word: 'Sync',
    line: 'Two people in one paragraph. A CRDT merges it without a lock.',
  },
] as const;

/**
 * Where the step line sits, as a fraction of the viewport from the top.
 * Must match the `rootMargin` in `useActiveStep`.
 */
const STEP_LINE = 0.85;

/*
 * Spacer heights, one per step. The first is short so the letters begin
 * soon after the name has been seen on its own; the last is long, so the
 * final letter is not cut off by the stage unpinning (see `useActiveStep`
 * for why the tail matters).
 */
const SPACERS = [
  'h-[30svh]',
  ...Array.from({ length: LETTERS.length - 1 }, () => 'h-[45svh]'),
  'h-[60svh]',
];

/*
 * Each caption sits under its own letter, so the word reads as coming out of
 * it: left under R and O, centred under B, right under I and S. Only from
 * `lg`, where the letters are far enough apart for the offset to land under
 * the right one; a phone keeps every caption flush left.
 */
const PLACEMENT = [
  'lg:justify-self-start lg:text-left',
  'lg:justify-self-start lg:text-left lg:ml-[24%]',
  'lg:justify-self-center lg:text-center',
  'lg:justify-self-end lg:text-right lg:mr-[16%]',
  'lg:justify-self-end lg:text-right',
] as const;

export function NameStage({ onLetter }: { onLetter: (letter: string | null) => void }) {
  // Step 0 is the name on its own; steps 1 to 5 are its letters.
  const [refs, step] = useActiveStep(LETTERS.length + 1);
  const reduced = useReducedMotion();
  const wrapper = useRef<HTMLDivElement>(null);
  /*
   * Whether the pinned name is still on screen. The step hook only hears
   * about its spacers, so once the last one has passed it keeps reporting
   * the last letter forever, and the field would stay in that letter's
   * formation behind everything below. Watching the stage itself ends it.
   */
  const [onStage, setOnStage] = useState(true);
  const active = step === 0 || !onStage ? null : step - 1;

  useEffect(() => {
    const element = wrapper.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;

    // The top half of the viewport: the stage counts as gone once nothing of
    // it is left there, which is when the next section has taken the screen.
    const observer = new IntersectionObserver(
      ([entry]) => setOnStage(Boolean(entry?.isIntersecting)),
      { rootMargin: '0px 0px -50% 0px', threshold: 0 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    onLetter(active === null ? null : (LETTERS[active]?.letter ?? null));
  }, [active, onLetter]);

  /**
   * Scroll so the step line sits in the middle of that letter's spacer.
   *
   * The middle rather than just past its edge: on iOS the toolbar can come
   * back during a smooth scroll, the viewport shrinks, the line moves up,
   * and a target only a few pixels past the edge would land on the letter
   * before.
   */
  function jumpTo(index: number) {
    const spacer = refs[index + 1]?.current;
    if (!spacer) return;

    const middle = spacer.getBoundingClientRect().top + window.scrollY + spacer.offsetHeight / 2;
    window.scrollTo({
      top: middle - window.innerHeight * STEP_LINE,
      behavior: reduced ? 'auto' : 'smooth',
    });
  }

  const current = active === null ? null : LETTERS[active];

  return (
    <div ref={wrapper} className="relative">
      <div className="sticky top-0 flex h-[100svh] flex-col justify-center px-[clamp(1rem,3vw,2.5rem)]">
        <div className="mx-auto w-full max-w-[1400px]">
          <Wordmark letters={LETTERS} active={active} onSelect={jumpTo} />

          {/* The captions are hidden from screen readers while they
              cross-fade; this says the same thing once, as each letter
              takes its turn. */}
          <p aria-live="polite" className="sr-only">
            {current ? `${current.word}. ${current.line}` : ''}
          </p>

          {/* Stacked in one grid cell so switching letters cross-fades in
              place and nothing below moves. */}
          <div className="mt-[clamp(2rem,6vh,4rem)] grid min-h-[clamp(7.5rem,19vh,11rem)]">
            {LETTERS.map((item, index) => (
              <div
                key={item.letter}
                data-caption=""
                data-active={index === active}
                aria-hidden={index !== active}
                className={`col-start-1 row-start-1 ${PLACEMENT[index]}`}
              >
                <p className="text-[clamp(2.25rem,5.2vw,4.75rem)] font-semibold leading-none tracking-[-0.04em] text-content">
                  <span className="text-accent-soft">{item.letter}</span>
                  {item.word.slice(1)}
                </p>
                <p className="mt-4 max-w-[40ch] text-[clamp(1rem,1.4vw,1.25rem)] leading-relaxed text-muted lg:inline-block">
                  {item.line}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {SPACERS.map((height, index) => (
        <div key={height + String(index)} ref={refs[index]} aria-hidden="true" className={height} />
      ))}
    </div>
  );
}
