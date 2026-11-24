'use client';

import { AGENT_ROLES, type AgentRole, contracts, type ResponseOf } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { call } from '../lib/api.ts';
import { DeleteButton } from './delete-button.tsx';
import { EmptyView } from './empty-view.tsx';
import { Avatar } from './ui/avatar.tsx';
import { AgentBadge, RoleBadge } from './ui/primitives.tsx';

type Agent = ResponseOf<(typeof contracts)['agents.list']>['agents'][number];
type Issued = { agentName: string; label: string; secret: string };

/**
 * A workspace's agents, for its admins (B5): add one as a member or a
 * guest, give it tokens, revoke them, remove it. A token's secret is shown
 * once, here, and kept nowhere: not in this page's cache, not on the
 * server, which holds only its hash. The API refuses all of this to anyone
 * who is not an admin; this panel only appears for those who may use it.
 */
export function AgentList({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const key = ['agents', workspaceId] as const;
  const [name, setName] = useState('');
  const [role, setRole] = useState<AgentRole>('MEMBER');
  const [triage, setTriage] = useState(false);
  const [shots, setShots] = useState(false);
  const [pictures, setPictures] = useState(false);
  const [summaries, setSummaries] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [copied, setCopied] = useState(false);
  /** The token whose revocation is waiting for a second click. */
  const [confirming, setConfirming] = useState<string | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ['members', workspaceId] });
  };
  const show = (next: Issued) => {
    setIssued(next);
    setCopied(false);
  };

  const agents = useQuery({
    queryKey: key,
    queryFn: () => call(contracts['agents.list'], { params: { workspaceId } }),
  });

  const create = useMutation({
    mutationFn: () =>
      call(contracts['agents.create'], {
        params: { workspaceId },
        body: { name: name.trim(), role, triage, summaries: triage && summaries, shots, pictures },
      }),
    onSuccess: ({ agent, token }) => {
      setName('');
      setTriage(false);
      setSummaries(false);
      show({ agentName: agent.name, label: token.label, secret: token.secret });
      refresh();
    },
  });

  const issue = useMutation({
    mutationFn: (agent: Agent) =>
      call(contracts['agents.issueToken'], {
        params: { workspaceId, agentId: agent.id },
        body: { label: `Token ${agent.tokens.length + 1}` },
      }).then(({ token }) => ({ agent, token })),
    onSuccess: ({ agent, token }) => {
      show({ agentName: agent.name, label: token.label, secret: token.secret });
      refresh();
    },
  });

  const revoke = useMutation({
    mutationFn: ({ agentId, tokenId }: { agentId: string; tokenId: string }) =>
      call(contracts['agents.revokeToken'], { params: { workspaceId, agentId, tokenId } }),
    onSuccess: () => {
      setConfirming(null);
      refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (agentId: string) =>
      call(contracts['agents.remove'], { params: { workspaceId, agentId } }),
    onSuccess: refresh,
  });

  // Renaming in place: the agent keeps its username, tokens and history.
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      call(contracts['agents.rename'], {
        params: { workspaceId, agentId: id },
        body: { name: name.trim() },
      }),
    onSuccess: () => {
      setRenaming(null);
      refresh();
    },
  });

  async function copy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.secret);
      setCopied(true);
    } catch {
      // Clipboard refused (an insecure origin, say): the token is selectable.
      setCopied(false);
    }
  }

  function onCreate(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) create.mutate();
  }

  const error = create.error ?? issue.error ?? revoke.error ?? remove.error;
  const list = agents.data?.agents ?? [];

  return (
    <section className="mt-12" aria-labelledby={`agents-heading-${workspaceId}`}>
      <h2
        id={`agents-heading-${workspaceId}`}
        className="text-sm font-medium uppercase tracking-wide text-faint"
      >
        Agents
      </h2>
      <p className="mt-1 max-w-prose text-sm text-muted">
        Programs that work here through the MCP server, as a member or a guest. What they do is
        recorded as an agent’s, and a person stays responsible for every issue.
      </p>
      <Link
        href={`/workspaces/${workspaceId}/agents`}
        className="mt-1 inline-block text-sm text-accent-soft hover:underline"
      >
        See what they did
      </Link>

      <form onSubmit={onCreate} className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          type="text"
          name="agent-name"
          autoComplete="off"
          maxLength={60}
          placeholder="Name, e.g. Triage bot…"
          aria-label="Agent name"
          className="min-w-48 flex-1 rounded-md border border-line bg-raised px-3 py-2 text-sm outline-none transition focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60"
        />
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as AgentRole)}
          aria-label="Role for the agent"
          className="rounded-md border border-line bg-raised px-2 py-2 text-sm text-muted outline-none transition focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {AGENT_ROLES.map((candidate) => (
            <option key={candidate} value={candidate}>
              {candidate}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={triage}
            onChange={(event) => setTriage(event.target.checked)}
            className="accent-[rgb(var(--accent))]"
          />
          Triages new issues
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={shots}
            onChange={(event) => setShots(event.target.checked)}
            className="accent-[rgb(var(--accent))]"
          />
          Posts Different shots (an idea a day to try)
        </label>
        <label
          className="flex items-center gap-2 text-sm text-muted"
          title="Fetches openly licensed pictures from NASA, Wikimedia Commons and Openverse; sends nothing from this workspace"
        >
          <input
            type="checkbox"
            checked={pictures}
            onChange={(event) => setPictures(event.target.checked)}
            className="accent-[rgb(var(--accent))]"
          />
          Posts a picture a day to the feed (openly licensed, credited)
        </label>
        {triage && (
          <label
            className="flex items-center gap-2 text-sm text-muted"
            title="Each new issue's title and description are sent to a third-party language model"
          >
            <input
              type="checkbox"
              checked={summaries}
              onChange={(event) => setSummaries(event.target.checked)}
              className="accent-[rgb(var(--accent))]"
            />
            Add a one-line summary (sends issue text to a third party)
          </label>
        )}
        <button
          type="submit"
          disabled={create.isPending || !name.trim()}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast transition hover:bg-accent-hover active:scale-[0.98] disabled:opacity-50"
        >
          {create.isPending ? 'Adding…' : 'Add agent'}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger-soft">
          {(error as Error).message}
        </p>
      )}

      {issued && (
        <div
          role="status"
          className="mt-3 rounded-lg border border-accent/40 bg-accent/10 p-4 text-sm"
        >
          <p className="text-content">
            {issued.label} for {issued.agentName}. Copy it now: it is not shown again.
          </p>
          <code
            translate="no"
            className="mt-2 block select-all break-all rounded-md bg-surface px-3 py-2 font-mono text-xs text-content"
          >
            {issued.secret}
          </code>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={copy}
              className="rounded-md border border-line px-3 py-1.5 text-xs text-content transition hover:bg-surface active:scale-[0.98]"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={() => setIssued(null)}
              className="rounded-md px-3 py-1.5 text-xs text-muted transition hover:text-content"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {list.length === 0 && agents.isSuccess && (
        <div className="mt-3 -mx-2">
          <EmptyView view="agents" compact />
        </div>
      )}

      <ul className="mt-3 space-y-3 empty:hidden">
        {list.map((agent) => {
          const live = agent.tokens.filter((token) => !token.revokedAt && !token.expiresAt);
          return (
            <li key={agent.id} className="rounded-lg border border-line bg-raised px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={agent.name} seed={agent.id} avatar={agent.avatar} size="md" />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      {renaming?.id === agent.id ? (
                        <form
                          className="flex items-center gap-1.5"
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (renaming.name.trim()) rename.mutate(renaming);
                          }}
                        >
                          <input
                            aria-label={`New name for ${agent.name}`}
                            value={renaming.name}
                            maxLength={60}
                            onChange={(event) =>
                              setRenaming({ id: agent.id, name: event.target.value })
                            }
                            onKeyDown={(event) => event.key === 'Escape' && setRenaming(null)}
                            className="w-36 rounded-md border border-line bg-surface px-2 py-0.5 text-sm text-content outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60"
                          />
                          <button
                            type="submit"
                            disabled={rename.isPending}
                            className="text-xs text-accent-soft hover:underline"
                          >
                            Save
                          </button>
                        </form>
                      ) : (
                        <span className="text-sm text-content">{agent.name}</span>
                      )}
                      <AgentBadge />
                      <RoleBadge role={agent.role} />
                    </span>
                    {agent.triage && (
                      <span className="block text-xs text-muted">
                        Triages new issues{agent.summaries ? ', with a one-line summary' : ''}
                      </span>
                    )}
                    {agent.shots && (
                      <span className="block text-xs text-muted">Posts Different shots</span>
                    )}
                    {agent.pictures && (
                      <span className="block text-xs text-muted">Posts a picture a day</span>
                    )}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRenaming({ id: agent.id, name: agent.name })}
                    aria-label={`Rename ${agent.name}`}
                    className="rounded-md px-2 py-1 text-xs text-muted transition hover:text-content"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => issue.mutate(agent)}
                    disabled={issue.isPending}
                    className="rounded-md border border-line px-3 py-1 text-xs text-content transition hover:bg-surface active:scale-[0.98] disabled:opacity-50"
                  >
                    New token
                  </button>
                  <DeleteButton
                    kind="agent"
                    name={agent.name}
                    cascade="Its tokens stop working at once and it leaves the workspace. What it wrote stays."
                    onConfirm={() => remove.mutateAsync(agent.id)}
                    className="-my-1"
                  />
                </span>
              </div>

              <ul className="mt-2 space-y-1 text-xs text-muted empty:hidden">
                {live.map((token) => (
                  <li key={token.id} className="flex items-center justify-between gap-3">
                    <span>
                      {token.label}
                      {token.lastUsedAt
                        ? ` · last used ${new Date(token.lastUsedAt).toLocaleDateString()}`
                        : ' · not used yet'}
                    </span>
                    {confirming === token.id ? (
                      <span className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => revoke.mutate({ agentId: agent.id, tokenId: token.id })}
                          disabled={revoke.isPending}
                          className="font-medium text-danger-soft transition hover:underline disabled:opacity-50"
                        >
                          {revoke.isPending ? 'Revoking…' : 'Revoke for good'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirming(null)}
                          className="text-muted transition hover:text-content"
                        >
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirming(token.id)}
                        aria-label={`Revoke ${token.label} of ${agent.name}`}
                        className="text-danger-soft transition hover:underline"
                      >
                        Revoke
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
