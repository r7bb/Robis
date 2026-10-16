'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type SentInvitation } from '../lib/api.ts';
import { RoleBadge } from './ui/primitives.tsx';

/**
 * Invitations this workspace has sent and nobody has answered, for the
 * people who may invite. Each can be withdrawn; the server refuses anyone
 * else, so this only appears when it would work.
 *
 * `focusAfter` is the id of the members heading, where focus goes when a
 * withdrawn row, or the whole list, disappears.
 */
export function SentInvitations({
  workspaceId,
  focusAfter,
}: {
  workspaceId: string;
  focusAfter: string;
}) {
  const queryClient = useQueryClient();
  const key = ['invitations', workspaceId] as const;
  const [said, setSaid] = useState('');

  const invitations = useQuery({
    queryKey: key,
    queryFn: () => api<{ invitations: SentInvitation[] }>(`/workspaces/${workspaceId}/invitations`),
  });

  const withdraw = useMutation({
    mutationFn: (invitation: SentInvitation) =>
      api<void>(`/workspaces/${workspaceId}/invitations/${invitation.id}`, { method: 'DELETE' }),
    onSuccess: (_, invitation) => {
      setSaid(`Withdrew the invitation to @${invitation.username}.`);
      document.getElementById(focusAfter)?.focus();
    },
    // Answered or withdrawn elsewhere in the meantime: drop it either way.
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const pending = invitations.data?.invitations ?? [];

  return (
    <>
      <p role="status" className="sr-only">
        {said}
      </p>

      {invitations.isError && (
        <p role="alert" className="mt-4 text-sm text-danger-soft">
          Pending invitations could not be loaded. {(invitations.error as Error).message}
        </p>
      )}

      {pending.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs font-medium uppercase tracking-wide text-faint">
            Waiting for an answer
          </h3>
          <ul className="mt-2 divide-y divide-line rounded-lg border border-dashed border-line">
            {pending.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
              >
                <span className="text-sm text-muted">
                  {invitation.name}
                  <span className="ml-2 text-xs text-faint">@{invitation.username}</span>
                </span>
                <span className="flex items-center gap-3">
                  <RoleBadge role={invitation.role} />
                  <button
                    type="button"
                    onClick={() => withdraw.mutate(invitation)}
                    disabled={withdraw.isPending}
                    aria-label={`Withdraw the invitation to @${invitation.username}`}
                    className="text-xs text-muted transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
                  >
                    Withdraw
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {withdraw.isError && (
            <p role="alert" className="mt-2 text-sm text-danger-soft">
              {(withdraw.error as Error).message}
            </p>
          )}
        </div>
      )}
    </>
  );
}
