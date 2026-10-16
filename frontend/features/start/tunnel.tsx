'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A train ride with a tunnel in it.
 *
 * Outside the tunnel a note goes straight to the team. Inside, with no
 * signal, it waits on your device instead, marked as waiting; coming out,
 * the waiting notes go one after another, in the order you wrote them.
 * The same promise Robis makes about the real app, told as a short trip.
 */

const LINES = [
  'Moved ROB-4 to Doing',
  'Commented on the launch plan',
  'Assigned ROB-7 to Mia',
  'Closed ROB-2',
  'Renamed the sprint',
  'Filed ROB-12',
] as const;

/** Gap between deliveries on the way out, so the order can be seen. */
const DELIVER_EVERY_MS = 320;
/** How many delivered notes stay on screen. */
const SHOWN = 5;

type Note = { id: number; line: string };

const BUTTON =
  'rounded-full px-3.5 py-1.5 text-sm transition-colors duration-[var(--micro)] ease-[var(--ease)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft active:scale-[0.98]';

function Column({
  label,
  empty,
  notes,
  tone,
  live = false,
}: {
  label: string;
  empty: string;
  notes: Note[];
  tone: 'waiting' | 'sent';
  live?: boolean;
}) {
  return (
    <section aria-label={label} className="min-h-[11rem] rounded-xl border border-white/10 p-3">
      <h3 className="text-xs text-faint">{label}</h3>
      <ul aria-live={live ? 'polite' : undefined} className="mt-2 space-y-1.5">
        {notes.map((note) => (
          <li
            key={note.id}
            className={
              tone === 'waiting'
                ? 'rounded-lg border border-amber-300/25 bg-amber-300/5 px-2.5 py-1.5 text-[13px] text-amber-100'
                : 'rounded-lg border border-emerald-400/20 bg-emerald-500/5 px-2.5 py-1.5 text-[13px] text-content'
            }
          >
            {note.line}
            {tone === 'waiting' ? (
              <span className="ml-2 font-mono text-[10px] text-amber-200/70">waiting</span>
            ) : null}
          </li>
        ))}
        {notes.length === 0 ? <li className="text-[13px] text-faint">{empty}</li> : null}
      </ul>
    </section>
  );
}

export function Tunnel({
  active,
  onSignal,
}: {
  active: boolean;
  /** Told when the signal drops or returns, so the background can follow. */
  onSignal: (online: boolean) => void;
}) {
  const [inTunnel, setInTunnel] = useState(false);
  const [waiting, setWaiting] = useState<Note[]>([]);
  const [delivered, setDelivered] = useState<Note[]>([]);
  const written = useRef(0);

  // Leaving the slide leaves the tunnel, so the background never stays dim.
  useEffect(() => {
    if (!active) setInTunnel(false);
  }, [active]);

  useEffect(() => {
    onSignal(!inTunnel);
  }, [inTunnel, onSignal]);

  // Out of the tunnel: deliver what waited, oldest first, one at a time.
  useEffect(() => {
    if (inTunnel || waiting.length === 0) return;
    const timer = setTimeout(() => {
      const [first, ...rest] = waiting;
      setWaiting(rest);
      if (first) setDelivered((sent) => [first, ...sent].slice(0, SHOWN));
    }, DELIVER_EVERY_MS);
    return () => clearTimeout(timer);
  }, [inTunnel, waiting]);

  const write = () => {
    const note = { id: written.current, line: LINES[written.current % LINES.length]! };
    written.current++;
    if (inTunnel) setWaiting((queue) => [...queue, note]);
    else setDelivered((sent) => [note, ...sent].slice(0, SHOWN));
  };

  return (
    <div
      data-tunnel={inTunnel}
      className="rounded-2xl border border-white/10 bg-[#0c0e13]/90 p-4 transition-colors duration-[var(--entrance)] ease-[var(--ease)] data-[tunnel=true]:border-amber-300/30 data-[tunnel=true]:bg-[#08090b]/95 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm">
          {inTunnel ? (
            <span className="text-amber-200">In the tunnel. No signal.</span>
          ) : (
            <span className="text-emerald-300">Out in the open. Connected.</span>
          )}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={write}
            className={`${BUTTON} border border-white/15 text-content hover:border-white/30`}
          >
            Write a note
          </button>
          <button
            type="button"
            onClick={() => setInTunnel((now) => !now)}
            className={`${BUTTON} bg-accent font-semibold text-accent-contrast hover:bg-accent-hover`}
          >
            {inTunnel ? 'Out of the tunnel' : 'Into the tunnel'}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Column
          label="Waiting on your device"
          empty="Nothing waiting."
          notes={waiting}
          tone="waiting"
          live
        />
        <Column
          label="Delivered to the team"
          empty="Write a note, then try it in the tunnel."
          notes={delivered}
          tone="sent"
          live
        />
      </div>
    </div>
  );
}
