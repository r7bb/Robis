'use client';

import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { ApiError, api, type Me, type WorkspaceSummary } from '../../lib/api.ts';
import { getSyncEngine } from '../../lib/sync.ts';

type Member = { userId: string; name: string; role: string };
type Choice = { action: 'transfer'; to: string } | { action: 'delete' };

/**
 * Deleting your own account (stage 1, item 10). Asks for the password, and
 * for every workspace you own, a clear choice: hand it to a member, or
 * delete it with everything in it. What you wrote in workspaces that stay
 * is kept, under "Deleted user"; your personal details are removed.
 */
export function DeleteAccount({ me }: { me: Me }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const workspaces = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api<{ workspaces: WorkspaceSummary[] }>('/workspaces'),
    enabled: open,
  });
  const owned = (workspaces.data?.workspaces ?? []).filter((w) => w.role === 'OWNER');
  const members = useQueries({
    queries: owned.map((w) => ({
      queryKey: ['members', w.id],
      queryFn: () => api<{ members: Member[] }>(`/workspaces/${w.id}/members`),
    })),
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    const undecided = owned.filter((w) => !choices[w.id]);
    if (undecided.length > 0) {
      setError(`Choose what happens to ${undecided.map((w) => w.name).join(', ')} first.`);
      return;
    }
    setPending(true);
    try {
      await api<void>('/auth/me', {
        method: 'DELETE',
        body: {
          password,
          workspaces: owned.map((w) => ({ id: w.id, ...choices[w.id]! })),
        },
      });
      await getSyncEngine().clearLocal();
      router.replace('/');
      queryClient.clear();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong. Try again.');
      setPending(false);
    }
  }

  if (!open) {
    return (
      <section
        aria-labelledby="delete-account"
        className="mt-12 rounded-2xl border border-danger/40 p-5"
      >
        <h2 id="delete-account" className="text-base font-semibold text-content">
          Delete your account
        </h2>
        <p className="mt-1 text-sm text-muted">
          Your details are removed for good. What you wrote in shared workspaces stays, under
          &ldquo;Deleted user&rdquo;.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 rounded-md border border-danger/60 px-3 py-1.5 text-sm text-danger-soft hover:bg-danger/10"
        >
          Delete account…
        </button>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="delete-account"
      className="mt-12 rounded-2xl border border-danger/40 p-5"
    >
      <h2 id="delete-account" className="text-base font-semibold text-content">
        Delete your account
      </h2>
      <form onSubmit={submit} className="mt-4 space-y-5">
        {owned.map((workspace, index) => {
          const others = (members[index]?.data?.members ?? []).filter(
            (m) => m.userId !== me.user.id,
          );
          const choice = choices[workspace.id];
          const set = (next: Choice) => setChoices((all) => ({ ...all, [workspace.id]: next }));
          return (
            <fieldset key={workspace.id} className="rounded-lg border border-line p-4">
              <legend className="px-1 text-sm font-medium text-content">{workspace.name}</legend>
              <label className="mt-1 flex items-center gap-2 text-sm text-muted">
                <input
                  type="radio"
                  name={`ws-${workspace.id}`}
                  disabled={others.length === 0}
                  checked={choice?.action === 'transfer'}
                  onChange={() => others[0] && set({ action: 'transfer', to: others[0].userId })}
                />
                Hand it to
                <select
                  aria-label={`New owner of ${workspace.name}`}
                  disabled={others.length === 0}
                  value={choice?.action === 'transfer' ? choice.to : ''}
                  onChange={(e) => set({ action: 'transfer', to: e.target.value })}
                  className="rounded-md border border-line bg-raised px-2 py-1 text-sm text-content"
                >
                  <option value="" disabled>
                    {others.length === 0 ? 'no other members' : 'choose a member'}
                  </option>
                  {others.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-2 flex items-center gap-2 text-sm text-muted">
                <input
                  type="radio"
                  name={`ws-${workspace.id}`}
                  checked={choice?.action === 'delete'}
                  onChange={() => set({ action: 'delete' })}
                />
                Delete it, with everything in it, for everyone
              </label>
            </fieldset>
          );
        })}

        <label className="block text-sm text-muted">
          Your password
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-md border border-line bg-raised px-3 py-2 text-sm text-content"
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-danger-soft">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-danger px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? 'Deleting…' : 'Delete my account'}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md px-3 py-2 text-sm text-muted hover:text-content"
          >
            Keep it
          </button>
        </div>
      </form>
    </section>
  );
}
