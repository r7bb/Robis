'use client';

import { diffEdit } from '@robis/shared';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { type Side, SyncPair, shiftCaret } from './sync-pair.ts';

/**
 * Two editors and a network switch: the claim on this page, made testable.
 *
 * Everything here is real. Each pane is its own Yjs document, the switch
 * stops updates crossing between them, and turning it back on runs the
 * same catch-up exchange a reconnecting client does. Nobody has to take
 * "nothing is lost" on faith; they can try to lose something.
 */

const SEED = `Launch checklist
- Offline queue drains in order
- Board keeps working with the network off`;

/** How long the "merged" confirmation stays up. */
const MERGED_NOTICE_MS = 2600;

/**
 * What Mia types on her own, once, shortly after the page loads.
 *
 * A demo that sits still until someone touches it reads as a picture of a
 * demo. Watching a line appear in your pane as she types it is the whole
 * claim in two seconds. It stops for good the moment the visitor types or
 * flips the switch, because from then on the demo is theirs.
 */
const MIA_LINE = '\n- Mia: reconnect toast reads well';
const MIA_START_MS = 1600;
const MIA_KEY_MS = 55;

const PEOPLE: Record<Side, { name: string; initials: string; tint: string }> = {
  you: { name: 'You', initials: 'YO', tint: 'bg-accent text-accent-contrast' },
  mia: { name: 'Mia', initials: 'ML', tint: 'bg-emerald-500 text-emerald-950' },
};

export type NetworkEvent = { online: boolean; merged: number };

export function SyncDemo({
  onNetwork,
  onActivity,
}: {
  onNetwork?: (event: NetworkEvent) => void;
  /** Called on every keystroke, from either side. */
  onActivity?: () => void;
}) {
  // One pair per mount, left to the garbage collector when the page goes. A
  // module-level pair would survive client navigation and keep the last
  // visitor's edits. There is nothing to tear down: two in-memory documents
  // hold no timers, sockets or storage, and destroying them on unmount broke
  // the relay under StrictMode's mount, unmount, mount in development.
  const [pair] = useState(() => new SyncPair(SEED));
  const subscribe = useCallback((listener: () => void) => pair.subscribe(listener), [pair]);

  const online = useSyncExternalStore(
    subscribe,
    () => pair.isOnline(),
    () => true,
  );

  const [mergedNotice, setMergedNotice] = useState<number | null>(null);
  const [miaTyping, setMiaTyping] = useState(false);

  // The latest callback, so the autoplay timer never calls a stale one.
  const activity = useRef(onActivity);
  // Updated after render, not during it: a render React discards must not
  // leave the ref pointing at its callback.
  useLayoutEffect(() => {
    activity.current = onActivity;
  });
  /** Set by any visitor input; ends the autoplay for good. */
  const touched = useRef(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let typed = 0;
    let timer = setTimeout(function tick() {
      if (touched.current || typed >= MIA_LINE.length) {
        setMiaTyping(false);
        return;
      }
      setMiaTyping(true);
      typed += 1;
      pair.edit('mia', pair.text('mia') + MIA_LINE.slice(typed - 1, typed));
      activity.current?.();
      timer = setTimeout(tick, MIA_KEY_MS);
    }, MIA_START_MS);

    return () => {
      clearTimeout(timer);
      setMiaTyping(false);
    };
  }, [pair]);

  const onEdit = useCallback(() => {
    touched.current = true;
    activity.current?.();
  }, []);

  useEffect(() => {
    if (mergedNotice === null) return;
    const timer = setTimeout(() => setMergedNotice(null), MERGED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [mergedNotice]);

  function toggle() {
    touched.current = true;
    const next = !online;
    const { merged } = pair.setOnline(next);
    // Going offline again retires the "back online" notice at once rather
    // than leaving it up beside a switch that now says otherwise.
    setMergedNotice(next && merged > 0 ? merged : null);
    onNetwork?.({ online: next, merged });
  }

  return (
    <div className="text-left">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Cut the network, type on both sides, then reconnect.</p>

        <button
          type="button"
          role="switch"
          aria-checked={online}
          onClick={toggle}
          className="group inline-flex min-h-11 items-center gap-3 rounded-full border border-white/15 bg-black/30 py-1.5 pl-2.5 pr-4 text-sm text-content backdrop-blur transition-colors duration-[var(--micro)] ease-[var(--ease)] hover:border-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft active:scale-[0.98]"
        >
          <span
            aria-hidden="true"
            className={`relative h-6 w-11 rounded-full transition-colors duration-[var(--quick)] ease-[var(--ease)] ${
              online ? 'bg-emerald-500/80' : 'bg-white/15'
            }`}
          >
            <span
              className={`absolute left-0 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform duration-[var(--quick)] ease-[var(--ease)] ${
                online ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </span>
          Network
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Pane pair={pair} side="you" online={online} onEdit={onEdit} />
        <Pane pair={pair} side="mia" online={online} onEdit={onEdit} typing={miaTyping} />
      </div>

      {/* A minimum, not a fixed height: on a narrow phone the longer
          messages wrap, and a fixed line would let them spill out. */}
      <p aria-live="polite" className="mt-3 min-h-5 text-sm">
        {mergedNotice !== null ? (
          <span className="text-emerald-300">
            Back online. Merged {mergedNotice} offline {mergedNotice === 1 ? 'edit' : 'edits'},
            nothing lost.
          </span>
        ) : online ? (
          <span className="text-faint">Live. Every keystroke reaches the other side.</span>
        ) : (
          <span className="text-amber-200">
            Offline. Edits are kept locally until you reconnect.
          </span>
        )}
      </p>
    </div>
  );
}

function Pane({
  pair,
  side,
  online,
  onEdit,
  typing = false,
}: {
  pair: SyncPair;
  side: Side;
  online: boolean;
  onEdit: () => void;
  /** Shown while this side is typing on its own. */
  typing?: boolean;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const person = PEOPLE[side];

  const subscribe = useCallback((listener: () => void) => pair.subscribe(listener), [pair]);
  const waiting = useSyncExternalStore(
    subscribe,
    () => pair.pending(side),
    () => 0,
  );

  /*
   * Uncontrolled on purpose. A controlled textarea re-renders with the new
   * value and the browser moves the caret to the end, so every keystroke
   * from the other side would yank yours away. Writing the value directly
   * lets the caret be carried across the edit with `shiftCaret`.
   */
  useEffect(() => {
    const element = field.current;
    if (!element) return;

    element.value = pair.text(side);

    return pair.subscribe(() => {
      const next = pair.text(side);
      if (element.value === next) return;

      const edit = diffEdit(element.value, next);
      const start = shiftCaret(element.selectionStart, edit);
      const end = shiftCaret(element.selectionEnd, edit);
      element.value = next;
      if (document.activeElement === element) element.setSelectionRange(start, end);
    });
  }, [pair, side]);

  return (
    <label className="flex flex-col rounded-xl border border-white/10 bg-[#0b0d12]/80 backdrop-blur transition-colors duration-[var(--quick)] ease-[var(--ease)] focus-within:border-white/25">
      <span className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-xs">
        <span
          aria-hidden="true"
          className={`grid h-5 w-5 place-items-center rounded-full text-[9px] font-semibold ${person.tint}`}
        >
          {person.initials}
        </span>
        <span className="text-content">{person.name}</span>
        <span className="ml-auto tabular-nums text-faint">
          {typing
            ? 'typing…'
            : online
              ? 'synced'
              : waiting === 0
                ? 'offline'
                : `${waiting} waiting`}
        </span>
      </span>

      <textarea
        ref={field}
        // Room for the seed plus a line from each side, so a merge does not
        // push the newest text below a scrollbar. Taller side by side, where
        // the panes share the height; shorter stacked on a phone.
        rows={5}
        // The seed is in the server HTML, so the panes are not empty boxes
        // before the script loads, or for anyone without it.
        defaultValue={pair.text(side)}
        spellCheck={false}
        aria-label={`${person.name}'s copy of the shared note`}
        onInput={(event) => {
          onEdit();
          pair.edit(side, event.currentTarget.value);
        }}
        // 16px on a phone: iOS Safari zooms the page into any field smaller
        // than that on focus, which throws the whole layout sideways.
        className="resize-none bg-transparent px-3 py-2.5 font-mono text-base leading-relaxed text-content outline-none sm:min-h-[10.5rem] sm:text-[13px]"
      />
    </label>
  );
}
