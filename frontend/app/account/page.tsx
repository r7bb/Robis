'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { ApiError, api, type Me, type SessionSummary } from '../../lib/api.ts';
import { lastTheme, useApplyTheme } from '../../lib/theme.ts';

/**
 * Account settings.
 *
 * Three things live here because they are the three a signed-in person needs
 * and could not previously do: change their display name, change their
 * password, and see and revoke the sessions attached to their account.
 *
 * Email is shown but not editable. It is the login identifier and the key
 * invitations are addressed to, so changing it needs a verification
 * round-trip; offering a field that silently breaks both would be worse than
 * not offering one.
 */
export default function AccountPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  useApplyTheme(lastTheme());

  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false });

  // Signed out, so there is no account to show.
  useEffect(() => {
    if (me.isError) router.replace('/login');
  }, [me.isError, router]);

  if (!me.data) return null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <nav className="text-sm text-faint">
        <Link href="/workspaces" className="hover:text-muted">
          Workspaces
        </Link>
        <span className="mx-2">/</span>
        <span className="text-muted">Account</span>
      </nav>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-content">Account</h1>

      <ProfileSection user={me.data.user} onSaved={() => queryClient.invalidateQueries()} />
      <PasswordSection />
      <SessionsSection />
    </main>
  );
}

function ProfileSection({ user, onSaved }: { user: Me['user']; onSaved: () => void }) {
  const [name, setName] = useState(user.name);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () => api<Me>('/auth/me', { method: 'PATCH', body: { name: name.trim() } }),
    onSuccess: () => {
      setSaved(true);
      onSaved();
    },
  });

  const unchanged = name.trim() === user.name || name.trim() === '';

  return (
    <Section title="Profile">
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (!unchanged) save.mutate();
        }}
        className="space-y-4"
      >
        <Labelled label="Email">
          {(id) => (
            <>
              {/* Read-only rather than absent: people look here to check
                  which account they are signed in as. */}
              <input
                id={id}
                value={user.email}
                readOnly
                disabled
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-faint"
              />
              <p className="mt-1 text-xs text-faint">
                Email cannot be changed yet - it is the login identifier.
              </p>

              <VerificationStatus verified={user.emailVerified} />
            </>
          )}
        </Labelled>

        <Labelled label="Display name">
          {(id) => (
            <input
              id={id}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setSaved(false);
              }}
              maxLength={80}
              className="w-full rounded-md border border-line bg-raised px-3 py-2 text-sm text-content outline-none transition focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60"
            />
          )}
        </Labelled>

        <Row>
          <button
            type="submit"
            disabled={unchanged || save.isPending}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
          >
            Save
          </button>
          {saved && !save.isPending && <Note>Saved.</Note>}
          <Failure error={save.error} />
        </Row>
      </form>
    </Section>
  );
}

/**
 * Whether the address has been confirmed, and a way to resend the link.
 *
 * Phrased as information rather than a warning. Nothing in Relay is gated on a
 * verified address, so a red banner demanding action would be a lie about the
 * consequences of ignoring it.
 */
function VerificationStatus({ verified }: { verified: boolean }) {
  const [sent, setSent] = useState(false);

  const resend = useMutation({
    mutationFn: () =>
      api<{ ok: true; alreadyVerified: boolean }>('/auth/email/resend', { method: 'POST' }),
    onSuccess: () => setSent(true),
  });

  if (verified) {
    return <p className="mt-2 text-xs text-muted">This address is verified.</p>;
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <p className="text-xs text-faint">Not verified yet.</p>

      {sent ? (
        <span className="text-xs text-muted">Link sent. Check your email.</span>
      ) : (
        <button
          type="button"
          onClick={() => resend.mutate()}
          disabled={resend.isPending}
          className="rounded text-xs text-accent-soft underline-offset-4 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
        >
          {resend.isPending ? 'Sending…' : 'Send a verification link'}
        </button>
      )}

      <Failure error={resend.error} />
    </div>
  );
}

function PasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);

  const change = useMutation({
    mutationFn: () =>
      api<{ ok: true }>('/auth/password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
    },
  });

  // Checked here as well as on the server: the confirmation field exists only
  // to catch a typo, so it never needs to be sent.
  const mismatch = confirm.length > 0 && next !== confirm;
  const ready = current.length > 0 && next.length >= 12 && next === confirm;

  return (
    <Section title="Password">
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (ready) change.mutate();
        }}
        className="space-y-4"
      >
        <Labelled label="Current password">
          {(id) => (
            <PasswordInput
              id={id}
              value={current}
              onChange={setCurrent}
              autoComplete="current-password"
            />
          )}
        </Labelled>

        <Labelled label="New password">
          {(id) => (
            <>
              <PasswordInput id={id} value={next} onChange={setNext} autoComplete="new-password" />
              <p className="mt-1 text-xs text-faint">At least 12 characters.</p>
            </>
          )}
        </Labelled>

        <Labelled label="Confirm new password">
          {(id) => (
            <>
              <PasswordInput
                id={id}
                value={confirm}
                onChange={setConfirm}
                autoComplete="new-password"
              />
              {mismatch && <p className="mt-1 text-xs text-danger-soft">Passwords do not match.</p>}
            </>
          )}
        </Labelled>

        <Row>
          <button
            type="submit"
            disabled={!ready || change.isPending}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
          >
            Change password
          </button>
          {done && !change.isPending && (
            <Note>Password changed. Every other session was signed out.</Note>
          )}
          <Failure error={change.error} />
        </Row>
      </form>
    </Section>
  );
}

function SessionsSection() {
  const queryClient = useQueryClient();

  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<{ sessions: SessionSummary[] }>('/auth/sessions'),
  });

  const revoke = useMutation({
    mutationFn: () => api<{ revoked: number }>('/auth/sessions', { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });

  const rows = sessions.data?.sessions ?? [];
  const others = rows.filter((row) => !row.current).length;

  return (
    <Section title="Active sessions">
      <p className="mb-3 text-sm text-faint">
        Every browser signed in to this account. Sessions are held server-side, so revoking one
        takes effect immediately rather than waiting for a token to expire.
      </p>

      <ul className="divide-y divide-line rounded-lg border border-line bg-raised">
        {rows.map((session) => (
          <li key={session.id} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
            <span className="min-w-0">
              <span className="block truncate text-sm text-content">
                {describeAgent(session.userAgent)}
              </span>
              <span className="text-xs text-faint">
                Last used {new Date(session.lastUsedAt).toLocaleString()}
              </span>
            </span>

            {session.current && (
              <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-soft">
                This device
              </span>
            )}
          </li>
        ))}
      </ul>

      <Row>
        <button
          type="button"
          disabled={others === 0 || revoke.isPending}
          onClick={() => revoke.mutate()}
          className="rounded-md border border-line px-4 py-2 text-sm text-muted hover:border-danger hover:text-danger-soft disabled:opacity-50 disabled:hover:border-line disabled:hover:text-muted"
        >
          {others === 0 ? 'No other sessions' : `Sign out ${others} other session(s)`}
        </button>
        <Failure error={revoke.error} />
      </Row>
    </Section>
  );
}

/**
 * A readable name for a user agent string.
 *
 * Deliberately crude. Parsing user agents properly is a losing game, and the
 * only question being answered here is "is that row me or not", which a family
 * name answers well enough.
 */
function describeAgent(agent: string | null): string {
  if (!agent) return 'Unknown device';

  // Ordered, because these strings overlap by design: every Chrome agent also
  // claims Safari, and every Edge agent also claims Chrome. First match wins.
  const match = (table: [RegExp, string][]) =>
    table.find(([pattern]) => pattern.test(agent))?.[1] ?? null;

  const browser =
    match([
      [/edg\//i, 'Edge'],
      [/chrome|crios/i, 'Chrome'],
      [/firefox|fxios/i, 'Firefox'],
      [/safari/i, 'Safari'],
    ]) ?? 'Browser';

  const platform = match([
    [/iphone|ipad/i, 'iOS'],
    [/android/i, 'Android'],
    [/mac os x/i, 'macOS'],
    [/windows/i, 'Windows'],
    [/linux/i, 'Linux'],
  ]);

  return platform ? `${browser} on ${platform}` : browser;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-faint">{title}</h2>
      {children}
    </section>
  );
}

/**
 * A labelled field.
 *
 * The control is passed as a function of its id so the `label` can point at it
 * with `htmlFor`. Wrapping the input in the label instead would associate them
 * implicitly, which is valid HTML but weaker: some assistive tech handles the
 * explicit form more reliably, and a static checker can verify it.
 */
function Labelled({
  label,
  children,
}: {
  label: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-muted">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="mt-4 flex flex-wrap items-center gap-3">{children}</div>;
}

function Note({ children }: { children: React.ReactNode }) {
  return <span className="text-sm text-faint">{children}</span>;
}

function Failure({ error }: { error: unknown }) {
  if (!error) return null;

  return (
    <span role="alert" className="text-sm text-danger-soft">
      {error instanceof ApiError || error instanceof Error ? error.message : 'Something went wrong'}
    </span>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  return (
    <input
      id={id}
      type="password"
      value={value}
      autoComplete={autoComplete}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-md border border-line bg-raised px-3 py-2 text-sm text-content outline-none transition focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60"
    />
  );
}
