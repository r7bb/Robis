'use client';

import { contracts } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ApiError, call } from '../../lib/api.ts';
import { ACCOUNT_EVENTS_KEY } from './account-activity.tsx';
import { QrCode } from './qr-code.tsx';

/**
 * Two-factor sign-in on the account page (C4): turn it on with an
 * authenticator app (scan the code, type the first number it shows), keep
 * the recovery codes it gives once, and later make new ones or turn it off.
 * Every change asks for the password; the last two ask for a code too.
 */

const STATE_KEY = ['two-factor'];
const FIELD =
  'w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-content placeholder:text-faint focus:border-accent-soft focus:outline-none';
const BUTTON =
  'rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition hover:bg-accent-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60';
const QUIET_BUTTON =
  'rounded-md border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft';

const messageOf = (error: unknown) =>
  error instanceof ApiError ? error.message : 'That did not work. Try again.';

/** The secret in groups of four, for typing into an app by hand. */
const grouped = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret;

/** Codes shown once, with a way to copy them and a nudge to keep them. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-sm text-content">
        Keep these recovery codes somewhere safe, apart from your phone. Each signs you in once if
        the phone is lost. They are shown only now.
      </p>
      <ol className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border border-line bg-surface p-3 font-mono text-sm text-content sm:grid-cols-2">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={QUIET_BUTTON}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(codes.join('\n'));
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? 'Copied' : 'Copy them'}
        </button>
        <button type="button" className={BUTTON} onClick={onDone}>
          I have kept them
        </button>
      </div>
    </div>
  );
}

/** Step one: the password; step two: scan and type the first code. */
function TurnOn({ onCodes }: { onCodes: (codes: string[]) => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const setup = useMutation({
    mutationFn: () => call(contracts['twoFactor.setup'], { body: { password } }),
  });
  const enable = useMutation({
    mutationFn: () => call(contracts['twoFactor.enable'], { body: { code } }),
    onSuccess: (answer) => onCodes(answer.recoveryCodes),
  });

  if (!setup.data) {
    return (
      <form
        className="space-y-2"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          setup.mutate();
        }}
      >
        <label className="block text-sm text-muted" htmlFor="tf-password">
          Your password, to start
        </label>
        <div className="flex gap-2">
          <input
            id="tf-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={FIELD}
          />
          <button type="submit" className={BUTTON} disabled={!password || setup.isPending}>
            Continue
          </button>
        </div>
        {setup.error ? (
          <p role="alert" className="text-sm text-danger-soft">
            {messageOf(setup.error)}
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <form
      className="flex flex-col gap-4 sm:flex-row"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        enable.mutate();
      }}
    >
      <QrCode text={setup.data.uri} label="QR code to scan with an authenticator app" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm text-content">
          Scan this with an authenticator app (1Password, Google Authenticator, Authy and others),
          then type the six-digit code it shows.
        </p>
        <p className="text-xs text-faint">
          Cannot scan? Type this key instead:{' '}
          <span className="select-all font-mono text-muted">{grouped(setup.data.secret)}</span>
        </p>
        <label className="sr-only" htmlFor="tf-first-code">
          The code the app shows
        </label>
        <div className="flex gap-2">
          <input
            id="tf-first-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className={`${FIELD} max-w-40 font-mono tracking-widest`}
          />
          <button type="submit" className={BUTTON} disabled={!code || enable.isPending}>
            Turn on
          </button>
        </div>
        {enable.error ? (
          <p role="alert" className="text-sm text-danger-soft">
            {messageOf(enable.error)}
          </p>
        ) : null}
      </div>
    </form>
  );
}

/** New recovery codes or turning it off: the password and a code, then the action. */
function Confirmed({
  action,
  label,
  onCodes,
  onDone,
}: {
  action: 'codes' | 'off';
  label: string;
  onCodes: (codes: string[]) => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const run = useMutation({
    mutationFn: async () => {
      if (action === 'codes') {
        const answer = await call(contracts['twoFactor.recoveryCodes'], {
          body: { password, code },
        });
        onCodes(answer.recoveryCodes);
      } else {
        await call(contracts['twoFactor.disable'], { body: { password, code } });
        onDone();
      }
    },
  });
  return (
    <form
      className="space-y-2"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        run.mutate();
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          type="password"
          aria-label="Your password"
          placeholder="Your password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={FIELD}
        />
        <input
          aria-label="A code from the app, or a recovery code"
          placeholder="Code from the app, or a recovery code"
          autoComplete="one-time-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          className={`${FIELD} font-mono`}
        />
      </div>
      <button type="submit" className={BUTTON} disabled={!password || !code || run.isPending}>
        {label}
      </button>
      {run.error ? (
        <p role="alert" className="text-sm text-danger-soft">
          {messageOf(run.error)}
        </p>
      ) : null}
    </form>
  );
}

export function TwoFactorSettings() {
  const queryClient = useQueryClient();
  const state = useQuery({
    queryKey: STATE_KEY,
    queryFn: () => call(contracts['twoFactor.state']),
  });
  const [codes, setCodes] = useState<string[] | null>(null);
  const [open, setOpen] = useState<'on' | 'codes' | 'off' | null>(null);
  const refresh = () => {
    setOpen(null);
    queryClient.invalidateQueries({ queryKey: STATE_KEY });
    queryClient.invalidateQueries({ queryKey: ACCOUNT_EVENTS_KEY });
  };
  const showCodes = (fresh: string[]) => {
    setCodes(fresh);
    refresh();
  };

  if (!state.data) return null;
  if (codes) return <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />;
  if (!state.data.available) {
    return (
      <p className="text-sm text-muted">
        Two-factor sign-in is not set up on this server yet, so it cannot be turned on here.
      </p>
    );
  }

  if (!state.data.enabled) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Off. With it on, signing in asks for a code from an app on your phone as well as your
          password, so a password someone else learns is not enough.
        </p>
        {open === 'on' ? (
          <TurnOn onCodes={showCodes} />
        ) : (
          <button type="button" className={BUTTON} onClick={() => setOpen('on')}>
            Turn on two-factor sign-in
          </button>
        )}
      </div>
    );
  }

  const left = state.data.recoveryCodesLeft;
  return (
    <div className="space-y-3">
      <p className="text-sm text-content">
        On. Signing in asks for a code from your authenticator app.{' '}
        <span className={left <= 2 ? 'text-danger-soft' : 'text-muted'}>
          {left} {left === 1 ? 'recovery code' : 'recovery codes'} left.
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-expanded={open === 'codes'}
          className={QUIET_BUTTON}
          onClick={() => setOpen(open === 'codes' ? null : 'codes')}
        >
          New recovery codes
        </button>
        <button
          type="button"
          aria-expanded={open === 'off'}
          className={QUIET_BUTTON}
          onClick={() => setOpen(open === 'off' ? null : 'off')}
        >
          Turn off
        </button>
      </div>
      {open === 'codes' ? (
        <Confirmed action="codes" label="Make new codes" onCodes={showCodes} onDone={refresh} />
      ) : null}
      {open === 'off' ? (
        <Confirmed action="off" label="Turn off two-factor" onCodes={showCodes} onDone={refresh} />
      ) : null}
    </div>
  );
}
