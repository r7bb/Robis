'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { ApiError, api, type Me } from '../../lib/api.ts';

type Mode = 'login' | 'register';

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const body = mode === 'register' ? { name, email, password } : { email, password };
      await api<Me>(`/auth/${mode}`, { method: 'POST', body });

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

        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          {mode === 'register' && (
            <Field label="Name" value={name} onChange={setName} autoComplete="name" required />
          )}

          <Field
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            required
          />

          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
          />

          {error && (
            <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger-soft">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-contrast transition hover:bg-accent-hover active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-reduce:transition-none motion-reduce:active:translate-y-0 disabled:opacity-50 disabled:active:translate-y-0"
          >
            {submitting ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

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
          }}
          className="mt-4 text-sm text-muted underline-offset-4 hover:text-content hover:underline"
        >
          {mode === 'login' ? 'Need an account?' : 'Already have an account?'}
        </button>
      </div>
    </main>
  );
}

function Field({
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
