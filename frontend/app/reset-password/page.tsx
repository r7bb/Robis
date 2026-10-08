'use client';

import { PASSWORD_MIN_LENGTH } from '@robis/shared/limits';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useState } from 'react';
import {
  AuthButton,
  AuthError,
  AuthField,
  AuthLink,
  AuthNotice,
  AuthShell,
} from '../../components/auth-shell.tsx';
import { ApiError, api } from '../../lib/api.ts';

/**
 * Choose a new password, having arrived from a mailed link.
 *
 * `useSearchParams` suspends during prerender, so the form sits inside a
 * boundary. Without one the whole route is forced to render dynamically and
 * the build says so.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetFallback />}>
      <ResetForm />
    </Suspense>
  );
}

/** Matches the real form's shape, so the swap is not a visible jump. */
function ResetFallback() {
  return (
    <AuthShell title="Choose a new password" subtitle="Reset your password.">
      <div className="mt-3 space-y-3" aria-hidden>
        <div className="h-[58px] animate-pulse rounded-md bg-raised motion-reduce:animate-none" />
        <div className="h-[58px] animate-pulse rounded-md bg-raised motion-reduce:animate-none" />
        <div className="h-[38px] animate-pulse rounded-md bg-raised motion-reduce:animate-none" />
      </div>
    </AuthShell>
  );
}

function ResetForm() {
  /*
   * Read on every render, deliberately.
   *
   * Capturing this once with a `useState` initialiser looks tidier and is
   * wrong: the route is statically prerendered, so the first render happens
   * with no search params at all and the initialiser would pin the token to
   * the empty string forever. The page then tells everyone arriving from a
   * perfectly good link that it was incomplete.
   */
  const token = useSearchParams().get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const tooShort = password.length > 0 && password.length < PASSWORD_MIN_LENGTH;
  const mismatch = confirm.length > 0 && password !== confirm;
  const ready = password.length >= PASSWORD_MIN_LENGTH && password === confirm;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await api<{ ok: true }>('/auth/password/reset', {
        method: 'POST',
        body: { token, newPassword: password },
      });
      setDone(true);

      /*
       * Take the spent token out of the address bar.
       *
       * Done here rather than on arrival. Stripping it on mount looks tidier
       * but breaks the page: the App Router patches `history.replaceState`, so
       * rewriting the URL remounts this component, and the remount reads a
       * location that no longer has a token -- the form then tells the user
       * their link was incomplete. By now the token is spent and worthless, so
       * a remount costs nothing and the credential stops riding in history.
       */
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', window.location.pathname);
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  // Arriving with no token is a broken or truncated link, which is worth
  // saying plainly rather than showing a form that cannot work.
  if (!token) {
    return (
      <AuthShell
        title="That link is incomplete"
        subtitle="Reset your password."
        footer={<AuthLink href="/forgot-password">Request a new link</AuthLink>}
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
      <AuthShell title="Password changed" subtitle="Reset your password.">
        <div className="mt-3 space-y-4">
          <AuthNotice>
            Every device signed in to this account has been signed out, including this one.
          </AuthNotice>

          <Link
            href="/login"
            className="block w-full rounded-md bg-accent px-3 py-2 text-center text-sm font-medium text-accent-contrast transition hover:bg-accent-hover active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-reduce:transition-none"
          >
            Sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Reset your password."
      footer={<AuthLink href="/login">Back to sign in</AuthLink>}
    >
      <form onSubmit={onSubmit} className="mt-3 space-y-3">
        <AuthField
          id="reset-password"
          label="New password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          required
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          error={tooShort ? `Use at least ${PASSWORD_MIN_LENGTH} characters.` : undefined}
        />

        <AuthField
          id="reset-confirm"
          label="Confirm new password"
          type="password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          required
          error={mismatch ? 'Passwords do not match.' : undefined}
        />

        {error && <AuthError message={error} />}

        <AuthButton disabled={!ready || submitting}>
          {submitting ? 'Saving…' : 'Set new password'}
        </AuthButton>
      </form>
    </AuthShell>
  );
}
