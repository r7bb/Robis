'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { formatRelative } from '../../lib/time.ts';
import type { FeedItem } from './describe.ts';

/** How often the "2m" labels move on, so a quiet strip does not go stale. */
const TICK_MS = 30_000;
/** The earlier events the strip keeps to hand. */
const EARLIER_SHOWN = 12;

/** One event: its workspace's colour, what happened and where, and when. */
function FeedLine({ item, accentBy }: { item: FeedItem; accentBy: ReadonlyMap<string, string> }) {
  return (
    <Link
      href={item.href}
      className="home-feed-item flex min-w-0 items-baseline gap-2.5 rounded px-1 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <span
        aria-hidden="true"
        className="h-3 w-1 shrink-0 translate-y-0.5 rounded-full bg-accent"
        style={
          accentBy.has(item.workspaceId)
            ? { backgroundColor: `rgb(${accentBy.get(item.workspaceId)})` }
            : undefined
        }
      />
      <span className="min-w-0 truncate text-muted">
        <span className="text-content">{item.text}</span> in {item.workspaceName}
      </span>
      <time
        aria-hidden="true"
        dateTime={new Date(item.at).toISOString()}
        className="ml-auto shrink-0 text-xs text-faint"
      >
        {formatRelative(new Date(item.at))}
      </time>
    </Link>
  );
}

/** The events before the newest, on a button press; Escape or a click elsewhere puts them away. */
function Earlier({
  items,
  accentBy,
}: {
  items: readonly FeedItem[];
  accentBy: ReadonlyMap<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  if (items.length === 0) return null;
  return (
    <div ref={box} className="relative shrink-0">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((was) => !was)}
        className="rounded-full px-2 py-0.5 text-xs text-muted transition-colors hover:bg-surface hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
      >
        Earlier ({items.length})
      </button>
      {open ? (
        <ol
          id={listId}
          className="absolute right-0 top-full z-20 mt-2 w-[min(32rem,80vw)] space-y-0.5 rounded-xl border border-line bg-raised p-2 shadow-lg shadow-black/30"
        >
          {items.map((item) => (
            <li key={item.id} className="text-sm">
              <FeedLine item={item} accentBy={accentBy} />
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/**
 * What is happening across your workspaces, on one line under the greeting:
 * the newest event, with the ones before it a press away. The Today cards
 * below take the room the full feed had. A log region, always mounted, so a
 * screen reader hears each new event once.
 */
export function LiveStrip({
  items,
  accentBy,
  connected,
  everConnected,
}: {
  items: readonly FeedItem[];
  /** Each workspace's accent, so a line carries the colour of its tile. */
  accentBy: ReadonlyMap<string, string>;
  connected: boolean;
  /** Before the first connection it is connecting, not reconnecting. */
  everConnected: boolean;
}) {
  const [, setNow] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const [latest, ...earlier] = items;

  return (
    <section
      aria-label="Latest across your workspaces"
      className="flex min-w-0 items-center gap-3 rounded-full border border-line bg-raised/80 px-4 py-1.5 text-sm"
    >
      <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${connected ? 'home-live-dot bg-emerald-400' : 'bg-faint'}`}
        />
        {connected ? 'Connected' : everConnected ? 'Reconnecting' : 'Connecting'}
      </span>
      <div role="log" aria-relevant="additions" className="min-w-0 flex-1">
        {latest ? (
          <FeedLine key={latest.id} item={latest} accentBy={accentBy} />
        ) : (
          <p className="truncate text-faint">
            Quiet so far. Changes from your teammates show here as they happen.
          </p>
        )}
      </div>
      <Earlier items={earlier.slice(0, EARLIER_SHOWN)} accentBy={accentBy} />
    </section>
  );
}
