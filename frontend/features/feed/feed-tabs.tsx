'use client';

import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

/**
 * The feed's three tabs (a quieter feed): Following, only the people you
 * follow; Everyone, the whole workspace less anyone you muted; Highlights,
 * the check-in, celebrations and how the projects are doing, which used to
 * stack above the posts. The tab you left on is remembered in this browser.
 */

export const FEED_TABS = ['following', 'everyone', 'highlights'] as const;
export type FeedTab = (typeof FEED_TABS)[number];

const LABELS: Record<FeedTab, string> = {
  following: 'Following',
  everyone: 'Everyone',
  highlights: 'Highlights',
};

const tabKey = (workspaceId: string) => `robis-feed-tab:${workspaceId}`;
const isTab = (value: unknown): value is FeedTab =>
  typeof value === 'string' && (FEED_TABS as readonly string[]).includes(value);

export const tabId = (tab: FeedTab) => `feed-tab-${tab}`;
export const panelId = (tab: FeedTab) => `feed-panel-${tab}`;

export function useFeedTab(workspaceId: string): [FeedTab, (tab: FeedTab) => void] {
  const [tab, setTab] = useState<FeedTab>('everyone');
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(tabKey(workspaceId));
      if (isTab(stored)) setTab(stored);
    } catch {
      // Storage refused: the feed opens on Everyone.
    }
  }, [workspaceId]);
  const choose = (next: FeedTab) => {
    setTab(next);
    try {
      window.localStorage.setItem(tabKey(workspaceId), next);
    } catch {
      // Remembered for this visit only.
    }
  };
  return [tab, choose];
}

export function FeedTabs({
  tab,
  onChange,
  waiting,
}: {
  tab: FeedTab;
  onChange: (tab: FeedTab) => void;
  /** Something in Highlights is waiting for you, such as this week's check-in. */
  waiting: boolean;
}) {
  const buttons = useRef<Record<FeedTab, HTMLButtonElement | null>>({
    following: null,
    everyone: null,
    highlights: null,
  });

  // Arrow keys move between tabs, as a tab list does (WAI-ARIA).
  function keys(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = FEED_TABS[(FEED_TABS.indexOf(tab) + step + FEED_TABS.length) % FEED_TABS.length]!;
    onChange(next);
    buttons.current[next]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="What the feed shows"
      onKeyDown={keys}
      className="mt-6 grid grid-cols-3 rounded-xl border border-line bg-raised p-1"
    >
      {FEED_TABS.map((id) => (
        <button
          key={id}
          ref={(element) => {
            buttons.current[id] = element;
          }}
          id={tabId(id)}
          type="button"
          role="tab"
          aria-selected={tab === id}
          aria-controls={panelId(id)}
          tabIndex={tab === id ? 0 : -1}
          onClick={() => onChange(id)}
          className={`relative rounded-lg px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${
            tab === id
              ? 'bg-surface font-medium text-content shadow-sm'
              : 'text-muted hover:text-content'
          }`}
        >
          {LABELS[id]}
          {id === 'highlights' && waiting ? (
            <>
              <span
                aria-hidden="true"
                className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-accent"
              />
              <span className="sr-only"> (something waiting)</span>
            </>
          ) : null}
        </button>
      ))}
    </div>
  );
}
