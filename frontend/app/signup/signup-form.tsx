'use client';

import { MINIMUM_AGE, TERMS_VERSION } from '@robis/shared';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { UsernameField } from '../../features/account/username-field.tsx';
import { ApiError, api, type Me } from '../../lib/api.ts';
import { getSyncEngine } from '../../lib/sync.ts';
import { Field } from '../login/login-form.tsx';

/**
 * Finishing a sign-up, from the link that was mailed. The link stands for
 * the address (opening it proves the inbox), so this asks for everything
 * else: a name, a username, a password, and the age and terms question.
 * The terms wording and the minimum age are drafts pending legal review.
 */
export function SignupForm({ token }: { token: string | null }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [error, setError] = useState<{ message: string; linkGone: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    setSubmitting(true);
    try {
      const signedIn = await api<Me>('/auth/register', {
        method: 'POST',
        body: {
          token,
          name,
          username: username.trim().toLowerCase(),
          password,
          ageConfirmed,
          // The terms this page showed, so a stale page cannot agree to
          // something that has since changed.
          termsVersion: TERMS_VERSION,
        },
      });
      await getSyncEngine().claimFor(signedIn.user.id);
      await queryClient.invalidateQueries();
      router.replace('/workspaces');
    } catch (cause) {
      setError({
        message: cause instanceof ApiError ? cause.message : 'Something went wrong',
        linkGone: cause instanceof ApiError && cause.code === 'signup_link_invalid',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-[100dvh] place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-content">Robis</h1>
        <p className="mt-1 text-sm text-muted">Finish creating your account.</p>

        {!token ? (
          <p role="alert" className="mt-6 text-sm text-muted">
            This page needs the link from your sign-up email.{' '}
            <Link href="/login?mode=register" className="text-content underline underline-offset-2">
              Start again
            </Link>
            .
          </p>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-3">
            <Field label="Name" value={name} onChange={setName} autoComplete="name" required />
            <UsernameField value={username} onChange={setUsername} />
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              required
            />
            <label className="flex items-start gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={ageConfirmed}
                onChange={(event) => setAgeConfirmed(event.target.checked)}
                required
                className="mt-0.5 h-4 w-4 accent-[var(--accent,currentColor)]"
              />
              <span>
                I am at least {MINIMUM_AGE}, and I agree to the{' '}
                <Link href="/terms" className="text-content underline underline-offset-2">
                  terms
                </Link>{' '}
                and the{' '}
                <Link href="/privacy" className="text-content underline underline-offset-2">
                  privacy notice
                </Link>
                .
              </span>
            </label>

            {error && (
              <p
                role="alert"
                className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger-soft"
              >
                {error.message}
                {error.linkGone && (
                  <>
                    {' '}
                    <Link href="/login?mode=register" className="underline underline-offset-2">
                      Send a new link
                    </Link>
                  </>
                )}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-contrast transition hover:bg-accent-hover active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-reduce:transition-none disabled:opacity-50"
            >
              {submitting ? 'Working…' : 'Create account'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
