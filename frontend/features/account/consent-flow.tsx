'use client';

import { MINIMUM_AGE } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { AuthButton, AuthError, AuthNotice, AuthShell } from '../../components/auth-shell.tsx';
import { ApiError, api, type Me } from '../../lib/api.ts';
import { UsernameField } from './username-field.tsx';

/**
 * What an account settles before anything else, asked only when it is
 * needed: agreeing to the current terms (after they change, or for an
 * account from before agreement was kept), then keeping or changing a
 * username that was given rather than chosen. Then on to `next`.
 *
 * The terms wording, like the pages it links to, is a draft pending legal
 * review; so is the minimum age.
 */

const LINK = 'text-content underline underline-offset-2';

function TermsStep({ me, onDone }: { me: Me; onDone: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const agree = useMutation({
    mutationFn: () =>
      api('/auth/me/consent', {
        method: 'POST',
        body: { termsVersion: me.user.consent.current, ageConfirmed: true },
      }),
    onSuccess: onDone,
  });

  const before = me.user.consent.termsVersion;
  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (confirmed) agree.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-4">
      <AuthNotice>
        {before
          ? `The terms changed since you agreed to them on ${before}. Read them again, and agree to go on.`
          : 'Robis now keeps a record of what each account agreed to. Agree to the current terms to go on.'}
      </AuthNotice>
      <label className="flex items-start gap-2 text-sm text-muted">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          required
          className="mt-0.5 h-4 w-4 accent-[var(--accent,currentColor)]"
        />
        <span>
          I am at least {MINIMUM_AGE}, and I agree to the{' '}
          <Link href="/terms" className={LINK}>
            terms
          </Link>{' '}
          and the{' '}
          <Link href="/privacy" className={LINK}>
            privacy notice
          </Link>
          .
        </span>
      </label>
      {agree.isError && <AuthError message={messageOf(agree.error)} />}
      <AuthButton disabled={!confirmed || agree.isPending}>Agree and continue</AuthButton>
    </form>
  );
}

function UsernameStep({ me, onDone }: { me: Me; onDone: () => void }) {
  const [changing, setChanging] = useState(false);
  const [username, setUsername] = useState(me.user.username);

  const keep = useMutation({
    mutationFn: () => api('/auth/me/username/confirm', { method: 'POST' }),
    onSuccess: onDone,
  });
  const change = useMutation({
    mutationFn: () =>
      api('/auth/me', { method: 'PATCH', body: { username: username.trim().toLowerCase() } }),
    onSuccess: onDone,
  });
  const error = keep.error ?? change.error;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (changing) change.mutate();
    else keep.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-4">
      <AuthNotice>
        Robis gave this account the username @{me.user.username}. It is how teammates mention you.
        Keep it, or choose your own.
      </AuthNotice>
      {changing ? (
        <UsernameField value={username} onChange={setUsername} current={me.user.username} />
      ) : null}
      {error && <AuthError message={messageOf(error)} />}
      <AuthButton disabled={keep.isPending || change.isPending}>
        {changing ? 'Save username' : `Keep @${me.user.username}`}
      </AuthButton>
      <button
        type="button"
        onClick={() => setChanging((now) => !now)}
        className="w-full text-sm text-muted underline-offset-4 transition-colors hover:text-content hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        {changing ? 'Keep the one I have' : 'Choose a different one'}
      </button>
    </form>
  );
}

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong';
}

export function ConsentFlow({ next }: { next: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false });

  const unauthenticated = me.isError;
  const settled = me.data && !me.data.user.consent.needed && me.data.user.usernameConfirmed;

  useEffect(() => {
    if (unauthenticated) router.replace('/login');
    else if (settled) router.replace(next);
  }, [unauthenticated, settled, next, router]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['me'] });

  if (!me.data || settled) return <main className="min-h-[100dvh]" />;

  return me.data.user.consent.needed ? (
    <AuthShell title="The terms" subtitle="Before you go on.">
      <TermsStep me={me.data} onDone={refresh} />
    </AuthShell>
  ) : (
    <AuthShell title="Your username" subtitle="One question, asked once.">
      <UsernameStep me={me.data} onDone={refresh} />
    </AuthShell>
  );
}
