'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthButton, AuthLink, AuthNotice, AuthShell } from '../../components/auth-shell.tsx';
import { ApiError, api } from '../../lib/api.ts';

/**
 * Confirm an address from a mailed link.
 *
 * Unlike the reset flow there is nothing to fill in, so the page spends the
 * token on arrival and reports what happened. Three states, all of them real:
 * working, confirmed, and a failure that names the likely cause.
 */
export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<VerifyShell>Loading…</VerifyShell>}>
      <Verify />
    </Suspense>
  );
}

function VerifyShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthShell title="Verify your email" subtitle="Confirm your address.">
      <div className="mt-3">
        <AuthNotice>{children}</AuthNotice>
      </div>
    </AuthShell>
  );
}

type State = 'ready' | 'working' | 'verified' | 'failed';

function Verify() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<State>(token ? 'ready' : 'failed');
  const [message, setMessage] = useState<string | null>(null);

  /**
   * Confirmed by a click, not on page load.
   *
   * The token is single-use, so whatever spends it first wins -- and plenty of
   * things open a link before its recipient does, including corporate mail
   * scanners that execute JavaScript. Spending it in an effect lets one of
   * those burn the link; a button means the person did it.
   */
  async function confirm() {
    setState('working');

    try {
      await api<{ ok: true }>('/auth/email/verify', { method: 'POST', body: { token } });
      setState('verified');
    } catch (cause: unknown) {
      setMessage(cause instanceof ApiError ? cause.message : 'Something went wrong');
      setState('failed');
    }
  }

  if (state === 'ready') {
    return (
      <AuthShell title="Verify your email" subtitle="Confirm your address.">
        <div className="mt-3 space-y-4">
          <AuthNotice>
            Confirming tells us this address reaches you. Nothing else about your account changes.
          </AuthNotice>

          <AuthButton type="button" onClick={confirm}>
            Confirm my address
          </AuthButton>
        </div>
      </AuthShell>
    );
  }

  if (state === 'working') return <VerifyShell>Confirming…</VerifyShell>;

  if (state === 'verified') {
    return (
      <AuthShell title="Address confirmed" subtitle="Confirm your address.">
        <div className="mt-3 space-y-4">
          <AuthNotice>Thanks. We know this address reaches you.</AuthNotice>

          <Link
            href="/workspaces"
            className="block w-full rounded-md bg-accent px-3 py-2 text-center text-sm font-medium text-accent-contrast transition hover:bg-accent-hover active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-reduce:transition-none"
          >
            Go to your workspaces
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="That link did not work"
      subtitle="Confirm your address."
      footer={<AuthLink href="/account">Send a new link from your account</AuthLink>}
    >
      <div className="mt-3 space-y-3">
        <AuthNotice>
          {token
            ? (message ?? 'The link is no longer valid.')
            : 'The address is missing its token.'}
        </AuthNotice>

        <p className="text-xs text-faint">
          Verification links expire after 24 hours and work only once. Your account still works
          either way; confirming only proves the address is yours.
        </p>
      </div>
    </AuthShell>
  );
}
