'use client';

import { contracts } from '@robis/shared';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { ApiError, call } from '../../lib/api.ts';
import { getSyncEngine } from '../../lib/sync.ts';

export type Mode = 'login' | 'register';

/**
 * The sign-in and sign-up form. `initialMode` comes from the page, which
 * reads `?mode=register` on the server, so the intro's "Create account"
 * lands on the sign-up form from the first paint.
 *
 * Signing up is email first: this asks only for the address and always
 * says "check your inbox", whatever the address, so the form cannot be
 * used to learn who has an account. The mailed link opens `/signup`,
 * where the name, username, password and the age and terms question are
 * asked.
 */
export function LoginForm({ initialMode }: { initialMode: Mode }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  /** The address a sign-up link went to, once one has. */
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (mode === 'register') {
        await call(contracts['auth.signup'], { body: { email } });
        setSentTo(email.trim());
        return;
      }
      const signedIn = await call(contracts['auth.login'], { body: { email, password } });

      // Offline data left by a different account on this browser must not be
      // shown to this person, or sent under their session.
      await getSyncEngine().claimFor(signedIn.user.id);

      // The session cookie changed, so anything cached under the old identity
      // is stale.
      await queryClient.invalidateQueries();
      router.replace('/workspaces');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-[100dvh] place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-content">Robis</h1>
        <p className="mt-1 text-sm text-muted">
          {mode === 'login' ? 'Sign in to your workspace.' : 'Create an account.'}
        </p>

        {mode === 'register' && sentTo ? (
          <div role="status" className="mt-6 rounded-md border border-line bg-raised px-4 py-3">
            <p className="text-sm font-medium text-content">Check your inbox</p>
            <p className="mt-1 text-sm text-muted">
              If {sentTo} can be used for a new account, a link to finish signing up is on its way.
              It works once, for 24 hours. Nothing arrived? Check spam, or send it again.
            </p>
            <button
              type="button"
              onClick={() => setSentTo(null)}
              className="mt-3 text-sm text-muted underline-offset-4 hover:text-content hover:underline"
            >
              Use a different address
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-3">
            <Field
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
              required
            />

            {mode === 'login' && (
              <Field
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                required
              />
            )}

            {error && (
              <p
                role="alert"
                className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger-soft"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-contrast transition hover:bg-accent-hover active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-reduce:transition-none motion-reduce:active:translate-y-0 disabled:opacity-50 disabled:active:translate-y-0"
            >
              {submitting ? 'Working…' : mode === 'login' ? 'Sign in' : 'Send me a link'}
            </button>
          </form>
        )}

        {mode === 'login' && (
          <Link
            href="/forgot-password"
            className="mt-4 block rounded text-sm text-muted underline-offset-4 transition hover:text-content hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            Forgot your password?
          </Link>
        )}

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
            setSentTo(null);
          }}
          className="mt-4 text-sm text-muted underline-offset-4 hover:text-content hover:underline"
        >
          {mode === 'login' ? 'Need an account?' : 'Already have an account?'}
        </button>
      </div>
    </main>
  );
}

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  ...rest
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      <input
        {...rest}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={type === 'email' ? false : undefined}
        inputMode={type === 'email' ? 'email' : undefined}
        className="w-full rounded-md border border-line bg-raised px-3 py-2 text-sm text-content outline-none transition focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60"
      />
    </label>
  );
}
