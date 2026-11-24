'use client';

import { contracts, TOKEN_LIFETIMES } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ApiError, call } from '../../lib/api.ts';
import { formatDate } from '../../lib/i18n/format.ts';
import { ACCOUNT_EVENTS_KEY } from './account-activity.tsx';

/**
 * Personal access tokens (C7): keys for the REST API that act as you on
 * workspace routes. Read only unless write is chosen; shown once; revoked
 * at once. A token cannot reach these settings, so it cannot make another.
 */

const FIELD =
  'w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-content focus:border-accent-soft focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-soft';
const BUTTON =
  'rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition hover:bg-accent-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60';
const QUIET_BUTTON =
  'rounded-md border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface hover:text-content disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft';

const KEY = ['api-tokens'] as const;
type Lifetime = (typeof TOKEN_LIFETIMES)[number] | null;

const dateOf = (iso: string) => formatDate(iso);

const messageOf = (error: unknown) =>
  error instanceof ApiError ? error.message : 'That did not work. Try again.';

export function ApiTokens() {
  const client = useQueryClient();
  const tokens = useQuery({ queryKey: KEY, queryFn: () => call(contracts['tokens.list']) });
  const [name, setName] = useState('');
  const [write, setWrite] = useState(false);
  const [password, setPassword] = useState('');
  const [lifetime, setLifetime] = useState<Lifetime>(90);
  const [shown, setShown] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: KEY });
    void client.invalidateQueries({ queryKey: ACCOUNT_EVENTS_KEY });
  };

  const make = useMutation({
    onMutate: () => {
      setShown(null);
      setCopied(false);
    },
    mutationFn: () =>
      call(contracts['tokens.create'], {
        body: { name: name.trim(), write, lifetimeDays: lifetime, password },
      }),
    onSuccess: (made) => {
      setShown(made.secret);
      setName('');
      setPassword('');
      refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (tokenId: string) => call(contracts['tokens.revoke'], { params: { tokenId } }),
    onSuccess: refresh,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    make.mutate();
  };
  const rows = tokens.data?.tokens ?? [];
  const error = make.error ?? revoke.error;

  return (
    <div className="space-y-4">
      <p className="max-w-prose text-sm text-muted">
        A token lets a script use the API as you, in your workspaces, with your role. Send it as{' '}
        <code className="font-mono text-xs">Authorization: Bearer</code>. It can only read unless
        you let it write, and it can never change these settings. Changing your password or signing
        out everywhere revokes every token.
      </p>

      {rows.length > 0 ? (
        <ul className="divide-y divide-line rounded-lg border border-line bg-raised">
          {rows.map((token) => (
            <li
              key={token.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
            >
              <span className="text-sm text-content">
                {token.name}
                <span className="ml-2 text-xs text-faint">
                  {token.scopes.includes('write') ? 'Reads and writes' : 'Reads only'} ·{' '}
                  {token.lastUsedAt ? `used ${dateOf(token.lastUsedAt)}` : 'never used'} ·{' '}
                  {token.expiresAt ? `until ${dateOf(token.expiresAt)}` : 'until revoked'}
                </span>
              </span>
              <button
                type="button"
                className={QUIET_BUTTON}
                aria-label={`Revoke the token ${token.name}`}
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(token.id)}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <form onSubmit={submit} className="space-y-3" aria-label="Make a token">
        <label className="block text-xs text-faint">
          What it is for
          <input
            className={`${FIELD} mt-1`}
            required
            maxLength={60}
            placeholder="Nightly report"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-center gap-4 text-sm text-content">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={write} onChange={(e) => setWrite(e.target.checked)} />
            Let it write
          </label>
          <label className="flex items-center gap-2 text-muted">
            Lasts
            <select
              className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-content"
              value={lifetime ?? 'never'}
              onChange={(e) =>
                setLifetime(
                  e.target.value === 'never' ? null : (Number(e.target.value) as Lifetime),
                )
              }
            >
              {TOKEN_LIFETIMES.map((days) => (
                <option key={days} value={days}>
                  {days} days
                </option>
              ))}
              <option value="never">Until revoked</option>
            </select>
          </label>
        </div>
        <label className="block text-xs text-faint">
          Your password, to confirm
          <input
            className={`${FIELD} mt-1`}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className={BUTTON}
          disabled={make.isPending || !name.trim() || !password}
        >
          {make.isPending ? 'Making…' : 'Make a token'}
        </button>
      </form>

      {error ? (
        <p role="alert" className="text-sm text-danger-soft">
          {messageOf(error)}
        </p>
      ) : null}
      <div role="status" className={shown ? 'rounded-md border border-line p-3' : 'sr-only'}>
        {shown ? (
          <>
            <p className="text-xs text-muted">
              The token, shown this once. Keep it somewhere safe; anyone holding it acts as you.
            </p>
            <code className="mt-1 block break-all font-mono text-xs text-content">{shown}</code>
            <button
              type="button"
              className={`${QUIET_BUTTON} mt-2`}
              onClick={() =>
                navigator.clipboard.writeText(shown).then(
                  () => setCopied(true),
                  () => setCopied(false),
                )
              }
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
