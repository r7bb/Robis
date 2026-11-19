'use client';

import { contracts } from '@robis/shared';
import { type FormEvent, useState } from 'react';
import { ApiError, call } from '../../lib/api.ts';

/**
 * The second step of signing in (C4): the password was right and the
 * account asks for a code too, from an authenticator app or a recovery
 * code. Too many wrong codes, or too long, and it is back to the password.
 */
export function CodeStep({
  challenge,
  onSignedIn,
  onRestart,
}: {
  challenge: string;
  onSignedIn: (userId: string) => Promise<void>;
  onRestart: (why: string | null) => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const signedIn = await call(contracts['auth.loginTwoFactor'], {
        body: { challenge, code },
      });
      await onSignedIn(signedIn.user.id);
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'Something went wrong';
      if (cause instanceof ApiError && cause.status === 401 && cause.code !== 'bad_code') {
        onRestart(message);
        return;
      }
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-3">
      <p className="text-sm text-muted">
        Type the six-digit code from your authenticator app, or one of your recovery codes.
      </p>
      <label className="block text-sm text-muted" htmlFor="login-code">
        Code
      </label>
      <input
        id="login-code"
        // biome-ignore lint/a11y/noAutofocus: the password was just accepted; the code is the one thing left to type
        autoFocus
        inputMode="numeric"
        autoComplete="one-time-code"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        className="w-full rounded-md border border-line bg-raised px-3 py-2 font-mono text-sm tracking-widest text-content outline-none transition focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60"
      />
      {error && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger-soft">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting || !code.trim()}
        className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-contrast transition hover:bg-accent-hover disabled:opacity-50"
      >
        {submitting ? 'Checking…' : 'Sign in'}
      </button>
      <button
        type="button"
        onClick={() => onRestart(null)}
        className="text-sm text-muted underline-offset-4 hover:text-content hover:underline"
      >
        Start again
      </button>
    </form>
  );
}
