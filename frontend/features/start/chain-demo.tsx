'use client';

import { useEffect, useRef, useState } from 'react';
import { buildChain, type ChainLink, editEvent, findBreak } from './mini-chain.ts';

/**
 * Four events, chained, that you can edit.
 *
 * Each row shows the start of its hash and of the one it follows. Change a
 * row's text and the check runs again, in the browser, with real SHA-256:
 * the row you changed turns red, and everything after it can no longer be
 * trusted. Put the text back and it holds again. That is the whole idea of
 * the audit trail, minus the key and the server.
 */

const EVENTS = [
  'Mia created the project Launch',
  'Sam filed ROB-12: offline toast',
  'Mia moved ROB-12 to In progress',
  'Sam closed ROB-12',
] as const;

/** Enough of a hash to see it change. */
const SHORT = 10;

const PLACEHOLDER = 'h-[22rem] rounded-2xl border border-white/10 bg-white/[0.02]';

function useChain() {
  const [chain, setChain] = useState<ChainLink[] | null>(null);
  const [broken, setBroken] = useState<number | null>(null);
  // Web Crypto exists only on secure origins; say so rather than spin.
  const [unavailable, setUnavailable] = useState(false);
  // Bumped by every edit, so a reset that finishes late cannot undo one.
  const version = useRef(0);

  useEffect(() => {
    let live = true;
    buildChain(EVENTS)
      .then((built) => {
        if (live) setChain(built);
      })
      .catch(() => {
        if (live) setUnavailable(true);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!chain) return;
    let live = true;
    void findBreak(chain).then((at) => {
      if (live) setBroken(at);
    });
    return () => {
      live = false;
    };
  }, [chain]);

  const edit = (index: number, text: string) => {
    version.current++;
    setChain((current) => (current ? editEvent(current, index, text) : current));
  };

  const reset = () => {
    const at = ++version.current;
    buildChain(EVENTS)
      .then((built) => {
        if (version.current === at) setChain(built);
      })
      .catch(() => setUnavailable(true));
  };

  return { chain, broken, unavailable, edit, reset };
}

export function ChainDemo({ active }: { active: boolean }) {
  const { chain, broken, unavailable, edit, reset } = useChain();

  if (unavailable) {
    return (
      <p className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-sm text-muted">
        This demo needs a secure connection to compute hashes in your browser.
      </p>
    );
  }
  if (!chain) return <div aria-hidden="true" className={PLACEHOLDER} />;

  const edited = chain.some((link, i) => link.text !== EVENTS[i]);

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0c0e13]/90 p-4 sm:p-5">
      <ol className="space-y-2">
        {chain.map((link, i) => {
          const state =
            broken === null || i < broken ? 'holds' : i === broken ? 'changed' : 'after';
          return (
            <li
              key={EVENTS[i]}
              data-chain-state={state}
              className="rounded-xl border border-white/10 bg-white/[0.02] p-3 transition-colors focus-within:ring-1 focus-within:ring-accent-soft/60 duration-[var(--entrance)] ease-[var(--ease)] data-[chain-state=after]:border-amber-300/25 data-[chain-state=changed]:border-red-400/60 data-[chain-state=changed]:bg-red-500/10"
            >
              <label className="block">
                <span className="sr-only">Event {i + 1}</span>
                <input
                  value={link.text}
                  onChange={(event) => edit(i, event.target.value)}
                  disabled={!active}
                  name={`event-${i + 1}`}
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full bg-transparent text-sm text-content outline-none"
                />
              </label>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 font-mono text-[11px] text-faint">
                <span>#{i + 1}</span>
                <span>hash {link.hash.slice(0, SHORT)}</span>
                <span>after {link.prev ? link.prev.slice(0, SHORT) : 'nothing'}</span>
                {/* Said in words too, not by colour alone. */}
                {state === 'changed' ? <span className="text-red-300">changed</span> : null}
                {state === 'after' ? <span className="text-amber-200">unverified</span> : null}
              </p>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" className="text-sm">
          {broken === null ? (
            <span className="text-emerald-300">Every link holds. Try changing a word above.</span>
          ) : (
            <span className="text-red-300">
              Broken at event {broken + 1}: its text no longer matches its hash, so nothing after it
              can be trusted.
            </span>
          )}
        </p>
        {/* Always there, so pressing it never drops focus with it. */}
        <button
          type="button"
          onClick={edited ? reset : undefined}
          aria-disabled={!edited}
          className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-muted transition-colors duration-[var(--micro)] ease-[var(--ease)] hover:border-white/30 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft aria-disabled:pointer-events-none aria-disabled:opacity-40"
        >
          Put it back
        </button>
      </div>
    </div>
  );
}
