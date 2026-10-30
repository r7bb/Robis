'use client';

import { contracts, ROLES, type Role, rankOf } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, call, type Me, type Member } from '../lib/api.ts';
import { DeleteButton } from './delete-button.tsx';
import { SentInvitations } from './sent-invitations.tsx';
import { Avatar } from './ui/avatar.tsx';
import { RoleBadge } from './ui/primitives.tsx';

/**
 * Workspace members: invite, change role, remove. An invitation waits
 * for the invited person's answer, so it is listed apart until then.
 *
 * The controls mirror the server's rules rather than reimplementing them --
 * every action here is refused by the API too. Hiding a button the caller
 * cannot use is a courtesy, not the enforcement.
 */
export function MemberList({
  workspaceId,
  viewerRole,
}: {
  workspaceId: string;
  viewerRole: Role | undefined;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('MEMBER');
  const [invited, setInvited] = useState<string | null>(null);

  const key = ['members', workspaceId] as const;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });

  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false });

  const members = useQuery({
    queryKey: key,
    queryFn: () => call(contracts['members.list'], { params: { workspaceId } }),
  });

  const invite = useMutation({
    mutationFn: (body: { email?: string; username?: string; role: Role }) =>
      call(contracts['members.invite'], { params: { workspaceId }, body }),
    onSuccess: ({ invitation }) => {
      setEmail('');
      setInvited('username' in invitation ? `@${invitation.username}` : invitation.email);
      queryClient.invalidateQueries({ queryKey: ['invitations', workspaceId] });
    },
  });

  const setMemberRole = useMutation({
    mutationFn: ({ userId, next }: { userId: string; next: Role }) =>
      call(contracts['members.setRole'], { params: { workspaceId, userId }, body: { role: next } }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (userId: string) =>
      call(contracts['members.remove'], { params: { workspaceId, userId } }),
    onSuccess: invalidate,
  });

  const canManage = viewerRole === 'OWNER' || viewerRole === 'ADMIN';
  const owners = (members.data?.members ?? []).filter((m) => m.role === 'OWNER').length;

  /** Mirrors `assertCanManage`: owners may manage peers, nobody else may. */
  function manageable(member: Member): boolean {
    if (!canManage || !viewerRole) return false;
    if (member.userId === me.data?.user.id) return false;
    return viewerRole === 'OWNER' || rankOf(viewerRole) > rankOf(member.role);
  }

  /** Mirrors `assertCanGrant`: you cannot hand out authority above your own. */
  const grantable = (): Role[] =>
    viewerRole ? ROLES.filter((candidate) => rankOf(candidate) <= rankOf(viewerRole)) : [];

  function onInvite(event: FormEvent) {
    event.preventDefault();
    // "@ada" or "ada" is a username; anything with an @ in the middle is an
    // address. The API validates both, so this only has to pick a field.
    const value = email.trim();
    if (!value) return;
    const isAddress = value.includes('@') && !value.startsWith('@');
    invite.mutate(
      isAddress
        ? { email: value, role }
        : { username: value.replace(/^@/, '').toLowerCase(), role },
    );
  }

  const error = invite.error ?? setMemberRole.error ?? remove.error;

  return (
    <section className="mt-12">
      <h2
        id={`members-heading-${workspaceId}`}
        tabIndex={-1}
        className="text-sm font-medium uppercase tracking-wide text-faint focus:outline-none"
      >
        Members
      </h2>

      {canManage && (
        <form onSubmit={onInvite} className="mt-3 flex flex-wrap gap-2">
          <input
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setInvited(null);
            }}
            type="text"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="@username or email"
            aria-label="Invite by email or username"
            className="min-w-56 flex-1 rounded-md border border-line bg-raised px-3 py-2 text-sm outline-none transition focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60"
          />

          <select
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
            aria-label="Role for the invited member"
            className="rounded-md border border-line bg-raised px-2 py-2 text-sm text-muted outline-none transition focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            {grantable().map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </select>

          <button
            type="submit"
            disabled={invite.isPending || !email.trim()}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
          >
            Invite
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger-soft">
          {(error as Error).message}
        </p>
      )}

      {/* Mounted from the start, so a screen reader hears the change. */}
      <p role="status" className="mt-2 text-sm text-muted empty:hidden">
        {invited && !error ? `Invited ${invited}. They join once they accept.` : ''}
      </p>

      <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-raised">
        {members.data?.members.map((member) => {
          // The last owner is protected server-side; showing the control and
          // then failing would be worse than not offering it.
          const lastOwner = member.role === 'OWNER' && owners <= 1;
          const editable = manageable(member) && !lastOwner;

          return (
            <li
              key={member.userId}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
            >
              <span className="flex items-center gap-2.5">
                <Avatar name={member.name} seed={member.userId} avatar={member.avatar} size="md" />
                <span className="text-sm text-content">{member.name}</span>
                <span className="ml-2 text-xs text-faint">
                  @{member.username}
                  {member.email ? ` · ${member.email}` : ''}
                </span>
              </span>

              <span className="flex items-center gap-2">
                {editable ? (
                  <select
                    value={member.role}
                    onChange={(event) =>
                      setMemberRole.mutate({
                        userId: member.userId,
                        next: event.target.value as Role,
                      })
                    }
                    aria-label={`Role for ${member.name}`}
                    className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-muted outline-none transition focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    {grantable().map((candidate) => (
                      <option key={candidate} value={candidate}>
                        {candidate}
                      </option>
                    ))}
                  </select>
                ) : (
                  <RoleBadge role={member.role} />
                )}

                <DeleteButton
                  allowed={editable}
                  kind="member"
                  name={member.name}
                  cascade="They lose access to this workspace immediately. Their issues and comments stay."
                  onConfirm={() => remove.mutateAsync(member.userId)}
                  className="-my-1"
                />
              </span>
            </li>
          );
        })}
      </ul>

      {canManage && (
        <SentInvitations workspaceId={workspaceId} focusAfter={`members-heading-${workspaceId}`} />
      )}
    </section>
  );
}
