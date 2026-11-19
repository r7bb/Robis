'use client';

import { contracts } from '@robis/shared';
import Link from 'next/link';
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

const SUBTITLE = 'A sign-in from a new browser.';

/**
 * "This was not me", from a new-device alert (C4). Opening the link changes
 * nothing, so a mail scanner that follows it does no harm: the button does.
 * Then everywhere is signed out, and the next step is a new password.
 */
export default function NotMePage() {
  return (
    <Suspense fallback={<NotMeFallback />}>
      <NotMe />
    </Suspense>
  );
}

function NotMeFallback() {
  return (
    <AuthShell title="Was this not you?" subtitle={SUBTITLE}>
      <div className="mt-3 space-y-3" aria-hidden>
        <div className="h-[84px] animate-pulse rounded-md bg-raised motion-reduce:animate-none" />
        <div className="h-[38px] animate-pulse rounded-md bg-raised motion-reduce:animate-none" />
      </div>
    </AuthShell>
  );
}

function NotMe() {
  // Read on every render, as on the reset page: the route is prerendered
  // without search params, so a value captured once would stay empty.
  const token = useSearchParams().get('token') ?? '';
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function signOutEverywhere() {
    setError(null);
    setSubmitting(true);
    try {
      await call(contracts['auth.notMe'], { body: { token } });
      // The address is left as it is: rewriting it remounts the page, which
      // would lose this answer, and the token in it is spent and worthless
      // now, on a page that sends no referrer and is never cached.
      setDone(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <AuthShell
        title="That link is incomplete"
        subtitle={SUBTITLE}
        footer={<AuthLink href="/login">Back to sign in</AuthLink>}
      >
        <div className="mt-3">
          <AuthNotice>
            The address is missing its token. Mail clients sometimes cut long links in half, so
            copying the whole thing into the address bar can help.
          </AuthNotice>
        </div>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title="Signed out everywhere" subtitle={SUBTITLE}>
        <div className="mt-3 space-y-4" role="status">
          <AuthNotice>
            Every browser signed in to this account has been signed out, whoever was using it. Now
            choose a new password: whoever signed in knows the old one.
          </AuthNotice>
          <Link
            href="/forgot-password"
            className="block w-full rounded-md bg-accent px-3 py-2 text-center text-sm font-medium text-accent-contrast transition hover:bg-accent-hover active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-reduce:transition-none"
          >
            Reset your password
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Was this not you?"
      subtitle={SUBTITLE}
      footer={<AuthLink href="/login">It was me, back to sign in</AuthLink>}
    >
      <div className="mt-3 space-y-3">
        <AuthNotice>
          This signs out every browser signed in to your account, this one included, and anyone else
          with it. You can then choose a new password.
        </AuthNotice>
        {error && <AuthError message={error} />}
        <AuthButton type="button" onClick={signOutEverywhere} disabled={submitting}>
          {submitting ? 'Signing out…' : 'Sign out everywhere'}
        </AuthButton>
      </div>
    </AuthShell>
  );
}
