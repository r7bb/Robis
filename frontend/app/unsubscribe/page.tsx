'use client';

import { contracts, type NotificationKind } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import {
  AuthButton,
  AuthError,
  AuthLink,
  AuthNotice,
  AuthShell,
} from '../../components/auth-shell.tsx';
import { ApiError, call } from '../../lib/api.ts';
import { NOTIFICATION_KIND_NAMES } from '../../lib/notification-kinds.ts';

/**
 * Stop notification emails from a link in one (C3), without signing in.
 *
 * The link opens this page rather than acting on its own: mail scanners and
 * link previews open every link in a message, and a link that unsubscribed
 * on being opened would unsubscribe people who never clicked it. The page
 * says what it would stop, and a button does it.
 */
export default function UnsubscribePage() {
  return (
    <Suspense fallback={<Shell>{null}</Shell>}>
      <Unsubscribe />
    </Suspense>
  );
}

function Shell({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <AuthShell
      title="Notification emails"
      subtitle="Stop the emails this link came in."
      footer={footer ?? <AuthLink href="/account">Choose what you hear about</AuthLink>}
    >
      <div className="mt-3 space-y-3">{children}</div>
    </AuthShell>
  );
}

/** The kinds a link is about, each with what it covers. */
function Kinds({ kinds }: { kinds: readonly NotificationKind[] }) {
  return (
    <ul className="divide-y divide-line rounded-md border border-line bg-raised text-sm">
      {kinds.map((kind) => (
        <li key={kind} className="px-3 py-2">
          <span className="block text-content">{NOTIFICATION_KIND_NAMES[kind].name}</span>
          <span className="block text-xs text-faint">{NOTIFICATION_KIND_NAMES[kind].when}</span>
        </li>
      ))}
    </ul>
  );
}

function Unsubscribe() {
  // Read on every render: see the reset page for why a captured copy breaks.
  const token = useSearchParams().get('token') ?? '';
  const [stopped, setStopped] = useState<NotificationKind[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = useQuery({
    queryKey: ['unsubscribe', token],
    queryFn: () => call(contracts['unsubscribe.preview'], { body: { token } }),
    enabled: token.length > 0 && stopped === null,
    retry: false,
  });

  // Before the token check: the spent token is taken out of the address once
  // used, and the page must still say it worked.
  if (stopped) {
    return (
      <Shell>
        <AuthNotice>
          Done. No more emails for these. They still show in the app, and you can turn their email
          back on from your account.
        </AuthNotice>
        <Kinds kinds={stopped} />
      </Shell>
    );
  }

  if (!token) {
    return (
      <Shell>
        <AuthNotice>
          The address is missing its token. Mail clients sometimes cut long links in half, so
          copying the whole thing into the address bar can help, or change your settings after
          signing in.
        </AuthNotice>
      </Shell>
    );
  }

  if (preview.isPending) {
    return (
      <Shell>
        <div className="h-[86px] animate-pulse rounded-md bg-raised motion-reduce:animate-none" />
      </Shell>
    );
  }

  if (preview.isError) {
    return (
      <Shell>
        <AuthNotice>
          This link has been used or has expired. Your settings are on your account page, after
          signing in.
        </AuthNotice>
      </Shell>
    );
  }

  async function stop() {
    setBusy(true);
    setError(null);
    try {
      const done = await call(contracts['unsubscribe.confirm'], { body: { token } });
      setStopped(done.kinds);
      // The token is spent; it need not ride along in history.
      window.history.replaceState(null, '', window.location.pathname);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <p className="text-sm text-muted">Stop emails for these? They will still show in the app.</p>
      <Kinds kinds={preview.data.kinds} />
      {error && <AuthError message={error} />}
      <AuthButton type="button" onClick={stop} disabled={busy}>
        {busy ? 'Stopping…' : 'Stop these emails'}
      </AuthButton>
    </Shell>
  );
}
