'use client';

import { contracts } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { call } from '../../lib/api.ts';

/**
 * Your calendar feed (B8): one private address a calendar app subscribes
 * to, for your meetings in every workspace you are in. The address is
 * shown once, when it is made; making another replaces it, and turning it
 * off makes the old one stop working at once.
 */

const FIELD =
  'w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs text-content focus:border-accent-soft focus:outline-none';
const BUTTON =
  'rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition hover:bg-accent-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60';
const QUIET_BUTTON =
  'rounded-md border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface hover:text-content disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft';

const FEED_KEY = ['calendar-feed'] as const;

const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function CalendarFeed() {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: FEED_KEY,
    queryFn: () => call(contracts['calendar.feed']),
  });
  const [shown, setShown] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const make = useMutation({
    mutationFn: () => call(contracts['calendar.createFeed']),
    onSuccess: (made) => {
      setShown(made.url);
      setCopied(false);
      void queryClient.invalidateQueries({ queryKey: FEED_KEY });
    },
  });
  const revoke = useMutation({
    mutationFn: () => call(contracts['calendar.revokeFeed']),
    onSuccess: () => {
      setShown(null);
      void queryClient.invalidateQueries({ queryKey: FEED_KEY });
    },
  });
  const busy = make.isPending || revoke.isPending;
  const feed = status.data?.feed ?? null;

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-3 text-sm text-muted">
      <p className="max-w-[65ch] leading-relaxed">
        Subscribe to your meetings from any calendar app, at their own local times. The address is
        private: anyone with it can see your meetings&apos; titles, times, agendas and join links,
        so treat it like a password. It keeps working when you sign out elsewhere or change your
        password, and it shows meetings from workspaces that ask for two-factor sign-in too, so turn
        it off here if it might have got out.
      </p>

      {shown ? (
        <div className="space-y-2">
          <label className="block text-xs text-faint" htmlFor="calendar-feed-url">
            Your feed address, shown this once
          </label>
          <div className="flex gap-2">
            <input
              id="calendar-feed-url"
              readOnly
              value={shown}
              className={FIELD}
              onFocus={(event) => event.currentTarget.select()}
            />
            <button type="button" className={QUIET_BUTTON} onClick={() => void copy(shown)}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-xs text-faint">
            Paste it where your calendar app offers to subscribe by URL.
          </p>
        </div>
      ) : null}

      {status.isPending ? null : feed ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-xs text-faint">On since {dateOf(String(feed.createdAt))}.</p>
          <button
            type="button"
            className={QUIET_BUTTON}
            disabled={busy}
            onClick={() => make.mutate()}
          >
            Make a new address
          </button>
          <button
            type="button"
            className={QUIET_BUTTON}
            disabled={busy}
            onClick={() => revoke.mutate()}
          >
            Turn it off
          </button>
        </div>
      ) : (
        <button type="button" className={BUTTON} disabled={busy} onClick={() => make.mutate()}>
          Make my feed address
        </button>
      )}

      {make.isError || revoke.isError ? (
        <p role="alert" className="text-xs text-danger-soft">
          That did not work. Try again in a moment.
        </p>
      ) : null}
    </div>
  );
}
