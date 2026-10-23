'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatRelative } from '../../lib/time.ts';
import type { FeedItem } from './describe.ts';

/** How often the "2m" labels move on, so a quiet feed does not go stale. */
const TICK_MS = 30_000;

/**
 * What is happening across your workspaces, newest first. Items that arrive
 * while the page is open slide in at the top; the list starts with the last
 * thing that happened in each workspace, so it is never blank on arrival.
 * A log region, always mounted, so a screen reader hears each new line once.
 */
export function LiveFeed({
  items,
  connected,
  everConnected,
}: {
  items: readonly FeedItem[];
  connected: boolean;
  /** Before the first connection it is connecting, not reconnecting. */
  everConnected: boolean;
}) {
  const [, setNow] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <section
      aria-labelledby="home-live"
      className="min-w-0 rounded-2xl border border-line bg-raised p-5 shadow-[0_12px_40px_rgb(8_9_12/0.45)]"
    >
      <div className="flex items-center justify-between">
        <h2 id="home-live" className="text-sm font-semibold text-content">
          Live
        </h2>
        <span className="flex items-center gap-2 text-xs text-muted">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${connected ? 'home-live-dot bg-emerald-400' : 'bg-faint'}`}
          />
          {connected ? 'Connected' : everConnected ? 'Reconnecting' : 'Connecting'}
        </span>
      </div>

      {/* The times are hidden from screen readers, so their ticking is not announced. */}
      <div role="log" aria-relevant="additions" className="mt-3">
        {items.length === 0 ? (
          <p className="pt-1 text-sm text-faint">
            Quiet so far. Changes from your teammates appear here as they happen.
          </p>
        ) : (
          <ol className="space-y-1">
            {items.map((item) => (
              <li key={item.id} className="home-feed-item">
                <Link
                  href={item.href}
                  className="flex items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-surface/60 focus-visible:bg-surface/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  <span className="min-w-0 truncate text-muted">
                    <span className="text-content">{item.text}</span> in {item.workspaceName}
                  </span>
                  <time
                    aria-hidden="true"
                    dateTime={new Date(item.at).toISOString()}
                    className="shrink-0 text-xs text-faint"
                  >
                    {formatRelative(new Date(item.at))}
                  </time>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
