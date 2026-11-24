'use client';

import { contracts } from '@robis/shared';
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, call } from '../../lib/api.ts';
import { formatDate } from '../../lib/i18n/format.ts';
import { ACCOUNT_EVENTS_KEY } from './account-activity.tsx';

/**
 * Passkeys on the account page (C4): sign in with a phone, laptop or
 * security key instead of a password. Adding one asks for the password and
 * then the device's own check (a fingerprint, face or PIN); removing one
 * is a click. Only names and dates are shown: the keys stay on the devices.
 */

const KEY = ['passkeys'];
const FIELD =
  'w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-content placeholder:text-faint focus:border-accent-soft focus:outline-none';
const BUTTON =
  'rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition hover:bg-accent-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60';
const QUIET_BUTTON =
  'rounded-md border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft';

const dateOf = (iso: string) => formatDate(iso);

function messageOf(error: unknown): string {
  // The browser's own prompt, closed or timed out: nothing went wrong here.
  if (error instanceof Error && error.name === 'NotAllowedError') {
    return 'The passkey was not made. Try again when your device is ready.';
  }
  return error instanceof ApiError ? error.message : 'That did not work. Try again.';
}

/** A name, the password (and a code, with two-factor on), then the device's own prompt. */
function AddPasskey({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const twoFactor = useQuery({
    queryKey: ['two-factor'],
    queryFn: () => call(contracts['twoFactor.state'], {}),
  });
  const needsCode = twoFactor.data?.enabled ?? false;
  const add = useMutation({
    mutationFn: async () => {
      const { challengeId, options } = await call(contracts['passkeys.registerOptions'], {
        body: { password, ...(needsCode ? { code } : {}) },
      });
      const response = await startRegistration({ optionsJSON: options as never });
      return call(contracts['passkeys.register'], {
        body: { challengeId, name: name.trim(), response: response as never },
      });
    },
    onSuccess: () => {
      setName('');
      setPassword('');
      setCode('');
      onAdded();
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    add.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Name it</span>
          <input
            className={FIELD}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My laptop"
            maxLength={60}
            required
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Your password</span>
          <input
            className={FIELD}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
      </div>
      {needsCode ? (
        <label className="block sm:w-1/2">
          <span className="mb-1 block text-xs font-medium text-muted">
            Code from your authenticator app
          </span>
          <input
            className={FIELD}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            required
          />
        </label>
      ) : null}
      <div aria-live="polite">
        {add.error ? <p className="text-sm text-danger-soft">{messageOf(add.error)}</p> : null}
      </div>
      <button
        type="submit"
        className={BUTTON}
        disabled={!name.trim() || !password || (needsCode && !code.trim()) || add.isPending}
      >
        {add.isPending ? 'Waiting for your device…' : 'Add a passkey'}
      </button>
    </form>
  );
}

export function PasskeySettings() {
  const queryClient = useQueryClient();
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => setSupported(browserSupportsWebAuthn()), []);
  const list = useQuery({ queryKey: KEY, queryFn: () => call(contracts['passkeys.list'], {}) });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: KEY });
    void queryClient.invalidateQueries({ queryKey: ACCOUNT_EVENTS_KEY });
  };
  const remove = useMutation({
    mutationFn: (passkeyId: string) =>
      call(contracts['passkeys.remove'], { params: { passkeyId } }),
    onSuccess: refresh,
  });
  const passkeys = list.data?.passkeys ?? [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Sign in with your phone, laptop or a security key instead of a password: it checks your
        fingerprint, face or PIN, so signing in with it needs no code after it, and a fake site
        cannot use it.
      </p>
      {passkeys.length > 0 ? (
        <ul className="divide-y divide-line rounded-md border border-line">
          {passkeys.map((passkey) => (
            <li key={passkey.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm text-content">{passkey.name}</p>
                <p className="text-xs text-faint">
                  Added {dateOf(passkey.createdAt)}
                  {passkey.lastUsedAt
                    ? `, last used ${dateOf(passkey.lastUsedAt)}`
                    : ', not used yet'}
                </p>
              </div>
              <button
                type="button"
                className={QUIET_BUTTON}
                disabled={remove.isPending}
                onClick={() => remove.mutate(passkey.id)}
                aria-label={`Remove ${passkey.name}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : list.isSuccess ? (
        <p className="text-sm text-faint">No passkeys yet.</p>
      ) : null}
      <div aria-live="polite">
        {remove.error ? (
          <p className="text-sm text-danger-soft">{messageOf(remove.error)}</p>
        ) : null}
      </div>
      {supported === false ? (
        <p className="text-sm text-muted">This browser cannot make passkeys.</p>
      ) : supported ? (
        <AddPasskey onAdded={refresh} />
      ) : null}
    </div>
  );
}
