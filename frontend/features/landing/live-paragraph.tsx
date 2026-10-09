'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { type Side, SyncPair, shiftCaret } from './sync-pair.ts';

/**
 * Two people typing into one sentence, at the same moment, live.
 *
 * This replaces a screenshot of the document editor, which could only
 * claim what this shows. Both cursors write through `SyncPair`, the same
 * pair of Yjs documents the hero demo uses, and each keystroke carries the
 * other person's cursor across it with `shiftCaret`, so neither one is
 * thrown off by the other's text arriving in front of it.
 *
 * It plays while on screen, holds the result, and plays again. Under
 * reduced motion it shows the merged sentence, still. Screen readers get
 * the finished sentence once rather than a stream of single characters.
 */

const SEED =
  'Convergence is a property of the data structure, not of who reached the server first.';

type Writer = { side: Side; name: string; initials: string; script: string; start: number };

const WRITERS: readonly [Writer, Writer] = [
  {
    side: 'you',
    name: 'You',
    initials: 'YO',
    // Mid-sentence, so the other cursor's text arrives on both sides of it.
    script: ' itself',
    start: SEED.indexOf(','),
  },
  {
    side: 'mia',
    name: 'Mia',
    // The same initials as in the hero demo, so she is one person on the page.
    initials: 'ML',
    script: ' So nobody waits for a lock.',
    start: SEED.length,
  },
];

const KEY_MS = 75;
const HOLD_MS = 2800;
const LEAD_IN_MS = KEY_MS * 6;

const [YOU, MIA] = WRITERS;

/** What the sentence says once both have finished. */
const FINAL = SEED.slice(0, YOU.start) + YOU.script + SEED.slice(YOU.start) + MIA.script;

const CARET: Record<Side, { bar: string; flag: string }> = {
  you: { bar: 'bg-accent', flag: 'bg-accent text-accent-contrast' },
  mia: { bar: 'bg-emerald-400', flag: 'bg-emerald-400 text-emerald-950' },
};

type Frame = { text: string; carets: Record<Side, number>; done: boolean };

const START: Frame = { text: SEED, carets: { you: YOU.start, mia: MIA.start }, done: false };

const FINISHED: Frame = {
  text: FINAL,
  carets: { you: YOU.start + YOU.script.length, mia: FINAL.length },
  done: true,
};

/** Whether the element is on screen right now, both ways. */
function useOnScreen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [onScreen, setOnScreen] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // No observer means no way to know, so play rather than sit unmerged.
    if (typeof IntersectionObserver === 'undefined') {
      setOnScreen(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) =>
      setOnScreen(Boolean(entry?.isIntersecting)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, onScreen] as const;
}

export function LiveParagraph() {
  const [ref, onScreen] = useOnScreen<HTMLDivElement>();
  const [frame, setFrame] = useState<Frame>(START);

  useEffect(() => {
    if (!onScreen) return;
    // Coming back on screen starts from the top rather than flashing
    // whatever was left from the last pass.
    setFrame(START);

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setFrame(FINISHED);
      return;
    }

    let pair = new SyncPair(SEED);
    let carets = START.carets;
    let typed: Record<Side, number> = { you: 0, mia: 0 };
    let turn = 0;
    let timer: ReturnType<typeof setTimeout>;

    const restart = () => {
      pair = new SyncPair(SEED);
      carets = START.carets;
      typed = { you: 0, mia: 0 };
      setFrame(START);
      timer = setTimeout(tick, LEAD_IN_MS);
    };

    const tick = () => {
      const remaining = WRITERS.filter((w) => typed[w.side] < w.script.length);

      if (remaining.length === 0) {
        setFrame({ text: pair.text('mia'), carets, done: true });
        timer = setTimeout(restart, HOLD_MS);
        return;
      }

      // Take turns, so both cursors are visibly moving at once.
      const writer = remaining[turn % remaining.length] ?? YOU;
      turn += 1;

      const char = writer.script[typed[writer.side]] ?? '';
      const at = carets[writer.side];
      const text = pair.text(writer.side);
      pair.edit(writer.side, text.slice(0, at) + char + text.slice(at));

      const other: Side = writer.side === 'you' ? 'mia' : 'you';
      carets = {
        ...carets,
        [writer.side]: at + char.length,
        [other]: shiftCaret(carets[other], { from: at, to: at, insert: char }),
      };
      typed = { ...typed, [writer.side]: typed[writer.side] + 1 };

      // Read from the other side's document: what arrived over the relay,
      // not what was typed locally. Online, the two are the same.
      setFrame({ text: pair.text(other), carets, done: false });
      timer = setTimeout(tick, KEY_MS);
    };

    timer = setTimeout(tick, LEAD_IN_MS);
    return () => clearTimeout(timer);
  }, [onScreen]);

  return (
    <div
      ref={ref}
      className="rounded-2xl border border-white/10 bg-[#0b0d12]/80 p-[clamp(1.25rem,2.5vw,2rem)] shadow-2xl shadow-black/60 backdrop-blur"
    >
      <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4 text-sm">
        <span className="text-content">Sync protocol notes</span>
        <span className="flex items-center gap-2 text-faint">
          {WRITERS.map((writer) => (
            <span
              key={writer.side}
              aria-hidden="true"
              className={`grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold ${CARET[writer.side].flag}`}
            >
              {writer.initials}
            </span>
          ))}
          2 editing
        </span>
      </div>

      <p className="sr-only">{FINAL}</p>
      {/* The finished sentence, invisible, in the same grid cell as the one
          being typed: it holds the card at its final height, so nothing
          below moves as the text grows. */}
      <div
        aria-hidden="true"
        className="mt-8 grid text-[clamp(1.1rem,1.6vw,1.45rem)] leading-[1.75] tracking-[-0.01em] text-content"
      >
        <p className="invisible col-start-1 row-start-1">{FINAL}</p>
        <p className="col-start-1 row-start-1">
          <Typed frame={frame} />
        </p>
      </div>

      <p className="mt-4 min-h-[2.5em] text-sm text-faint sm:min-h-0">
        {frame.done
          ? 'Both edits are in, in the same sentence. Nobody waited for a lock.'
          : 'Two people, one sentence, the same moment.'}
      </p>
    </div>
  );
}

/** The text with each person's cursor and name flag set into it. */
function Typed({ frame }: { frame: Frame }) {
  const marks = WRITERS.map((writer) => ({ writer, at: frame.carets[writer.side] })).sort(
    (a, b) => a.at - b.at,
  );

  const pieces: ReactNode[] = [];
  let from = 0;
  for (const { writer, at } of marks) {
    pieces.push(frame.text.slice(from, at));
    pieces.push(<Caret key={writer.side} side={writer.side} name={writer.name} />);
    from = at;
  }
  pieces.push(frame.text.slice(from));

  return <>{pieces}</>;
}

function Caret({ side, name }: { side: Side; name: string }) {
  return (
    <span className="relative inline-block h-[1.1em] w-0 align-[-0.15em]">
      <span className={`absolute inset-y-0 -left-px w-[2px] rounded-full ${CARET[side].bar}`} />
      <span
        className={`absolute -left-px -top-[1.35em] whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold leading-none tracking-normal ${CARET[side].flag}`}
      >
        {name}
      </span>
    </span>
  );
}
