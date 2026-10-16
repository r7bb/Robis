'use client';

import { useState } from 'react';

/**
 * A messy desk of notes that becomes a board as you tap them.
 *
 * Each note starts scattered at an angle. A tap sends it to To do, the next
 * to Doing, then Done, gliding there on the page's curve. Nothing here is
 * the real board; it is the idea of one, small enough to finish in ten
 * seconds.
 */

const COLUMNS = ['To do', 'Doing', 'Done'] as const;

const NOTES = [
  { key: 'ROB-3', text: 'Fix the login copy', at: [6, 30, -7] },
  { key: 'ROB-8', text: 'Ship dark mode', at: [44, 12, 5] },
  { key: 'ROB-2', text: 'Reply to Sam', at: [62, 46, -4] },
  { key: 'ROB-5', text: 'Book the review', at: [20, 60, 8] },
  { key: 'ROB-9', text: 'Write the release note', at: [54, 72, -9] },
  { key: 'ROB-1', text: 'Plan next week', at: [10, 4, 3] },
] as const;

/** 0 is still on the desk; 1 to 3 are the columns. */
type Place = 0 | 1 | 2 | 3;

const COLUMN_WIDTH = 100 / COLUMNS.length;

function describe(key: string, text: string, place: Place): string {
  const where = place === 0 ? 'On the desk' : `In ${COLUMNS[place - 1]}`;
  const next = place === 3 ? '' : ` Move to ${COLUMNS[place]}.`;
  return `${key}: ${text}. ${where}.${next}`;
}

/** Said after every tap, so the board can be followed without seeing it. */
function status(places: readonly Place[], moved: number | null): string {
  const done = places.filter((place) => place === 3).length;
  if (done === NOTES.length) return 'All done. That was a week of work, sorted.';
  if (moved === null) return 'Tap a note to put it on the board.';
  const note = NOTES[moved]!;
  return `${note.key} moved to ${COLUMNS[places[moved]! - 1]}. ${done} of ${NOTES.length} done.`;
}

export function SortDesk() {
  const [places, setPlaces] = useState<Place[]>(() => NOTES.map(() => 0));
  const [moved, setMoved] = useState<number | null>(null);

  const move = (index: number) => {
    if (places[index] === 3) return;
    setPlaces((current) =>
      current.map((place, i) => (i === index ? (Math.min(place + 1, 3) as Place) : place)),
    );
    setMoved(index);
  };

  const reset = () => {
    setPlaces(NOTES.map(() => 0));
    setMoved(null);
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0c0e13]/90 p-4 sm:p-5">
      <div className="grid grid-cols-3 gap-2 text-xs text-faint">
        {COLUMNS.map((column) => (
          <p key={column} className="border-b border-white/10 pb-2">
            {column}
          </p>
        ))}
      </div>

      {/* --desk-row is one note's height plus a gap, so all six fit in one
          column; notes wrap to two lines on a phone, so it is taller there. */}
      <div className="relative mt-3 h-[28rem] [--desk-row:74px] sm:h-[22rem] sm:[--desk-row:58px]">
        {NOTES.map((note, i) => {
          const place = places[i]!;
          // Where it sits: scattered on the desk, or in its column's next slot.
          const row = places.slice(0, i).filter((other) => other === place).length;
          const style =
            place === 0
              ? { left: `${note.at[0]}%`, top: `${note.at[1]}%`, rotate: `${note.at[2]}deg` }
              : {
                  left: `calc(${(place - 1) * COLUMN_WIDTH}% + 2px)`,
                  top: `calc(${row} * var(--desk-row))`,
                  rotate: '0deg',
                };
          return (
            <button
              key={note.key}
              type="button"
              // aria-disabled, so a note reaching Done keeps the focus it had.
              aria-disabled={place === 3}
              onClick={() => move(i)}
              style={style}
              aria-label={describe(note.key, note.text, place)}
              data-desk-place={place}
              className="absolute w-[calc(33.333%-6px)] rounded-lg border border-white/10 bg-[#161922] px-3 py-2 text-left shadow-lg shadow-black/30 transition-[left,top,rotate,background-color,border-color] duration-[560ms] ease-[var(--ease)] hover:border-accent-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft aria-disabled:cursor-default data-[desk-place=3]:border-emerald-400/30 data-[desk-place=3]:bg-emerald-500/10 motion-reduce:transition-none"
            >
              <span translate="no" className="block font-mono text-[10px] text-faint">
                {note.key}
              </span>
              <span className="mt-0.5 block text-[13px] leading-snug text-content">
                {note.text}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm text-muted">
          {status(places, moved)}
        </p>
        <button
          type="button"
          onClick={reset}
          aria-disabled={!places.some((place) => place > 0)}
          className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-muted transition-colors duration-[var(--micro)] ease-[var(--ease)] hover:border-white/30 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft aria-disabled:pointer-events-none aria-disabled:opacity-40"
        >
          Mess it up again
        </button>
      </div>
    </div>
  );
}
