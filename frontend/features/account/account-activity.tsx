'use client';

import { contracts, type ResponseOf } from '@robis/shared';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { ago } from '../../components/activity-feed.tsx';
import { call } from '../../lib/api.ts';

type AccountChain = ResponseOf<(typeof contracts)['auth.verifyEvents']>;

type Label = { text: (payload: Record<string, unknown>) => string; flag?: true };

/** Plain words for each kind of event, and which ones deserve a second look. */
const LABELS: Record<string, Label> = {
  'auth.signed_in': { text: () => 'Signed in' },
  'auth.sign_in_failed': {
    text: () => 'Someone tried to sign in with a wrong password',
    flag: true,
  },
  'auth.signed_out': { text: () => 'Signed out' },
  'auth.password_changed': { text: () => 'Password changed' },
  'auth.password_reset': { text: () => 'Password reset from an emailed link' },
  'auth.username_changed': { text: () => 'Username changed' },
  'auth.username_confirmed': { text: () => 'Username kept' },
  'auth.terms_accepted': {
    text: (payload) =>
      typeof payload.termsVersion === 'string'
        ? `Agreed to the terms of ${payload.termsVersion}`
        : 'Agreed to the terms',
  },
  'auth.sessions_revoked': {
    text: (payload) => {
      const count = typeof payload.count === 'number' ? payload.count : 0;
      return `Signed out ${count} other ${count === 1 ? 'session' : 'sessions'}`;
    },
  },
};

export const ACCOUNT_EVENTS_KEY = ['account-events'];

const PAGE_SIZE = 30;

function checkMessage(result: AccountChain | undefined, failed: boolean): string {
  if (failed) return 'The history could not be checked.';
  if (!result) return '';
  if (result.ok) {
    return `No break found in ${result.checked} ${result.checked === 1 ? 'event' : 'events'}.`;
  }
  return `Event ${result.broken?.seq} was changed or removed after it was written.`;
}

/**
 * The account's own trail, in settings: what has happened to this account,
 * newest first, with a check that nothing in it was changed.
 */
export function AccountActivity() {
  const events = useInfiniteQuery({
    queryKey: ACCOUNT_EVENTS_KEY,
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) =>
      call(contracts['auth.events'], {
        query: { limit: PAGE_SIZE, ...(pageParam === null ? {} : { before: pageParam }) },
      }),
    getNextPageParam: (last) => last.nextCursor,
  });

  const check = useMutation({
    mutationFn: () => call(contracts['auth.verifyEvents']),
  });

  const rows = events.data?.pages.flatMap((page) => page.events) ?? [];

  return (
    <>
      <p className="mb-3 text-sm text-faint">
        Sign-ins, failed attempts, password changes and sessions signed out, for this account only.
        Only you can see this. Nothing is kept about where a sign-in came from.
      </p>

      {events.isError ? (
        // A failed load must never read as an empty, clean history.
        <p className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger-soft">
          Your history could not be loaded. Try again in a moment.
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-line bg-raised px-4 py-3 text-sm text-muted">
          {events.isPending ? 'Loading…' : 'Nothing yet. Your next sign-in will appear here.'}
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-raised">
          {rows.map((event) => {
            const label = LABELS[event.type];
            return (
              <li key={event.seq} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                <span
                  className={`min-w-0 text-sm ${label?.flag ? 'text-danger-soft' : 'text-content'}`}
                >
                  {label ? label.text(event.payload) : event.type}
                </span>
                <time
                  dateTime={event.occurredAt}
                  title={new Date(event.occurredAt).toLocaleString()}
                  className="shrink-0 text-xs text-faint"
                >
                  {ago(event.occurredAt)}
                </time>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {events.hasNextPage ? (
          <button
            type="button"
            onClick={() => events.fetchNextPage()}
            disabled={events.isFetchingNextPage}
            className="rounded-md border border-line px-4 py-2 text-sm text-muted hover:border-accent-soft hover:text-content disabled:opacity-50"
          >
            {events.isFetchingNextPage ? 'Loading…' : 'Show older'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => check.mutate()}
          disabled={check.isPending}
          className="rounded-md border border-line px-4 py-2 text-sm text-muted hover:border-accent-soft hover:text-content disabled:opacity-50"
        >
          {check.isPending ? 'Checking…' : 'Check this history'}
        </button>
        <span aria-live="polite" className="text-sm text-faint">
          {checkMessage(check.data, check.isError)}
        </span>
      </div>
    </>
  );
}
