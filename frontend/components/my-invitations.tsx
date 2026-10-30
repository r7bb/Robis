'use client';

import { contracts } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, call, type Me, type MyInvitation } from '../lib/api.ts';
import { RoleBadge } from './ui/primitives.tsx';

/** Invitations arrive from other people, with no event to key off. */
const POLL_MS = 30_000;

/**
 * Invitations waiting for you, on the workspaces page.
 *
 * Nothing joins your list until you say yes. Accepting needs a confirmed
 * email address; until then the panel says so, offers the link again, and
 * Join explains itself rather than sitting greyed out.
 *
 * `focusAfter` is the id of something on the page that stays put (the
 * page heading), so focus has somewhere to go when the answered row, or
 * the whole panel, disappears.
 */
export function MyInvitations({ me, focusAfter }: { me: Me | undefined; focusAfter: string }) {
  const queryClient = useQueryClient();
  const key = ['my-invitations'] as const;
  const [said, setSaid] = useState('');

  const invitations = useQuery({
    queryKey: key,
    queryFn: () => call(contracts['invitations.mine']),
    enabled: Boolean(me),
    refetchInterval: POLL_MS,
  });

  const answer = useMutation({
    mutationFn: ({ invitation, verb }: { invitation: MyInvitation; verb: 'accept' | 'decline' }) =>
      call(contracts[verb === 'accept' ? 'invitations.accept' : 'invitations.decline'], {
        params: { invitationId: invitation.id },
      }),
    onSuccess: (_, { invitation, verb }) => {
      setSaid(
        verb === 'accept'
          ? `Joined ${invitation.workspace.name}.`
          : `Declined the invitation to ${invitation.workspace.name}.`,
      );
      document.getElementById(focusAfter)?.focus();
    },
    // Settled, not just succeeded: an invitation withdrawn in the meantime
    // is refused, and the list should drop it rather than wait for a poll.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const resend = useMutation({
    mutationFn: () => api<{ ok: true }>('/auth/email/resend', { method: 'POST' }),
  });

  const pending = invitations.data?.invitations ?? [];
  const verified = me?.user.emailVerified ?? false;

  return (
    <>
      {/* Always mounted, so the outcome is heard even when the panel goes. */}
      <p role="status" className="sr-only">
        {said}
      </p>

      {invitations.isError && (
        <p role="alert" className="mt-6 text-sm text-danger-soft">
          Invitations could not be loaded. {(invitations.error as Error).message}
        </p>
      )}

      {pending.length > 0 && (
        <section aria-labelledby="my-invitations" className="mt-8">
          <h2
            id="my-invitations"
            className="text-sm font-medium uppercase tracking-wide text-faint"
          >
            Invitations
          </h2>

          {!verified && (
            <p id="confirm-to-join" className="mt-2 text-sm text-muted">
              Confirm your email address to join.{' '}
              <button
                type="button"
                onClick={() => resend.mutate()}
                disabled={resend.isPending}
                className="text-accent-soft underline underline-offset-4 transition-colors hover:text-content disabled:opacity-60"
              >
                Send the link again
              </button>
              <span role="status" className="ml-2 text-faint">
                {resend.isSuccess ? 'Sent. Check your inbox.' : ''}
                {resend.isError ? (resend.error as Error).message : ''}
              </span>
            </p>
          )}

          <ul className="mt-3 space-y-2">
            {pending.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3"
              >
                <span className="text-sm text-content">
                  <span className="font-medium">{invitation.workspace.name}</span>
                  {invitation.invitedBy && (
                    <span className="ml-2 text-xs text-faint">from @{invitation.invitedBy}</span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  <RoleBadge role={invitation.role} />
                  <button
                    type="button"
                    onClick={() => answer.mutate({ invitation, verb: 'decline' })}
                    disabled={answer.isPending}
                    aria-label={`Decline the invitation to ${invitation.workspace.name}`}
                    className="rounded-md px-3 py-1.5 text-sm text-muted transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (verified) answer.mutate({ invitation, verb: 'accept' });
                    }}
                    disabled={answer.isPending}
                    // aria-disabled, not disabled, while unconfirmed: it stays
                    // reachable, and says why it does nothing.
                    aria-disabled={!verified}
                    aria-describedby={verified ? undefined : 'confirm-to-join'}
                    aria-label={`Join ${invitation.workspace.name}`}
                    className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                  >
                    Join
                  </button>
                </span>
              </li>
            ))}
          </ul>

          {answer.isError && (
            <p role="alert" className="mt-2 text-sm text-danger-soft">
              {(answer.error as Error).message}
            </p>
          )}
        </section>
      )}
    </>
  );
}
