'use client';

import { contracts } from '@robis/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type FormEvent, useId, useState } from 'react';
import {
  AuthButton,
  AuthError,
  AuthField,
  AuthLink,
  AuthShell,
} from '../../components/auth-shell.tsx';
import { ApiError, call } from '../../lib/api.ts';
import { getSyncEngine } from '../../lib/sync.ts';
import { CodeStep } from './code-step.tsx';
import { PasskeyButton } from './passkey-button.tsx';

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
  /** The password was right and the account asks for a code too (C4). */
  const [challenge, setChallenge] = useState<string | null>(null);
  const ids = useId();

  /** Signed in: the same next steps whether it took one step or two. */
  async function enter(userId: string) {
    // Offline data left by a different account on this browser must not be
    // shown to this person, or sent under their session.
    await getSyncEngine().claimFor(userId);

    // The session cookie changed, so anything cached under the old identity
    // is stale.
    await queryClient.invalidateQueries();
    router.replace('/workspaces');
  }

  /** The password step: in, or on to the code when the account asks for one. */
  async function withPassword() {
    const signedIn = await call(contracts['auth.login'], { body: { email, password } });
    if ('twoFactor' in signedIn) {
      setChallenge(signedIn.twoFactor.challenge);
      setPassword('');
      return;
    }
    await enter(signedIn.user.id);
  }

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
      await withPassword();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Could not reach Robis. Check your connection and try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  // The password was right and a code is owed: that is all the page asks.
  if (challenge) {
    return (
      <AuthShell subtitle="One more step to sign in.">
        <CodeStep
          challenge={challenge}
          onSignedIn={enter}
          onRestart={(why) => {
            setChallenge(null);
            setError(why);
          }}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell subtitle={mode === 'login' ? 'Sign in to your workspace.' : 'Create an account.'}>
      {mode === 'register' && sentTo ? (
        <SentPanel to={sentTo} onAgain={() => setSentTo(null)} />
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          <AuthField
            id={`${ids}-email`}
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            required
          />

          {mode === 'login' && (
            <AuthField
              id={`${ids}-password`}
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              required
            />
          )}

          {error && <AuthError message={error} />}

          <AuthButton disabled={submitting}>
            {submitting ? 'Working…' : mode === 'login' ? 'Sign in' : 'Send me a link'}
          </AuthButton>
        </form>
      )}

      {mode === 'login' && <PasskeyButton onSignedIn={enter} onError={setError} />}

      {mode === 'login' && (
        <p className="mt-4 text-sm">
          <AuthLink href="/forgot-password">Forgot your password?</AuthLink>
        </p>
      )}

      <button
        type="button"
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login');
          setError(null);
          setSentTo(null);
        }}
        className="mt-4 rounded text-sm text-muted underline-offset-4 hover:text-content hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        {mode === 'login' ? 'Need an account?' : 'Already have an account?'}
      </button>
    </AuthShell>
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

/** After an address is given for a new account: where the link went, and a way back. */
function SentPanel({ to, onAgain }: { to: string; onAgain: () => void }) {
  return (
    <div role="status" className="mt-6 rounded-md border border-line bg-raised px-4 py-3">
      <p className="text-sm font-medium text-content">Check your inbox</p>
      <p className="mt-1 text-sm text-muted">
        If {to} can be used for a new account, a link to finish signing up is on its way. It works
        once, for 24 hours. Nothing arrived? Check spam, or send it again.
      </p>
      <button
        type="button"
        onClick={onAgain}
        className="mt-2 rounded py-1 text-sm text-muted underline-offset-4 hover:text-content hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        Use a different address
      </button>
    </div>
  );
}
