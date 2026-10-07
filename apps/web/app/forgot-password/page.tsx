'use client';

import { PASSWORD_RESET_TTL_MINUTES } from '@relay/shared/limits';
import { type FormEvent, useState } from 'react';
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
 * Ask for a reset link.
 *
 * The confirmation deliberately does not say whether an account exists. The
 * server answers identically for every address, and a page that said "we
 * couldn't find that account" would hand the information straight back.
 *
 * So the success copy is phrased as a condition rather than a promise: a link
 * is on its way *if* the address has an account. That is the honest wording
 * for a response that cannot confirm either way.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await api<{ ok: true }>('/auth/password/forgot', { method: 'POST', body: { email } });
      setSent(true);
    } catch (cause) {
      // Only a transport or rate-limit failure reaches here; the endpoint
      // itself does not fail on an unknown address.
      setError(cause instanceof ApiError ? cause.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        subtitle="We’ll email you a link."
        footer={<AuthLink href="/login">Back to sign in</AuthLink>}
      >
        <div className="mt-3 space-y-3">
          <AuthNotice>
            If <span className="text-content">{email}</span> has a Relay account, a reset link is on
            its way. The link works once and expires in {PASSWORD_RESET_TTL_MINUTES} minutes.
          </AuthNotice>

          <p className="text-xs text-faint">
            Nothing arrived? Check the spam folder, then try again with the address you signed up
            with.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We’ll email you a link."
      footer={<AuthLink href="/login">Back to sign in</AuthLink>}
    >
      <form onSubmit={onSubmit} className="mt-3 space-y-3">
        <AuthField
          id="forgot-email"
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
          hint="We'll send a link to this address if it has an account."
        />

        {error && <AuthError message={error} />}

        <AuthButton disabled={submitting || email.trim() === ''}>
          {submitting ? 'Sending…' : 'Send reset link'}
        </AuthButton>
      </form>
    </AuthShell>
  );
}
