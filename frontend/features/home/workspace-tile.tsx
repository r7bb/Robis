'use client';

import { can, type PresenceUser, resolveTheme, type ServerEvent } from '@robis/shared';
import Link from 'next/link';
import { type CSSProperties, type PointerEvent, useEffect, useState } from 'react';
import { DeleteButton } from '../../components/delete-button.tsx';
import { Avatar } from '../../components/ui/avatar.tsx';
import { RoleBadge } from '../../components/ui/primitives.tsx';
import type { WorkspaceSummary } from '../../lib/api.ts';
import { type ConnectionState, useRealtime } from '../../lib/realtime.ts';
import { formatRelative } from '../../lib/time.ts';
import { ActivitySpark } from './activity-spark.tsx';
import { LiveNumber } from './live-number.tsx';
import type { WorkspaceOverview } from './use-overview.ts';

export type TileSignals = {
  onEvent: (event: ServerEvent) => void;
  onPresence: (workspaceId: string, users: PresenceUser[], state: ConnectionState) => void;
  /** The tile stopped listening: forget who it said was here. */
  onGone: (workspaceId: string) => void;
};

/** Follows the pointer with two CSS variables: no React render per move. */
function trackSpotlight(event: PointerEvent<HTMLElement>) {
  const box = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty('--spot-x', `${event.clientX - box.left}px`);
  event.currentTarget.style.setProperty('--spot-y', `${event.clientY - box.top}px`);
}

/**
 * One workspace on the home: how much is open, two weeks of activity, who
 * is in it and who is here right now, and what happened last. The whole
 * tile opens the workspace; deleting stays its own button above the link.
 *
 * With `live`, it keeps its own connection to the gateway: presence comes
 * from there, and each event makes the tile pulse once and is passed up for
 * the feed and the field.
 */
export function WorkspaceTile({
  workspace,
  overview,
  myId,
  live,
  signals,
  style,
  onDelete,
}: {
  workspace: WorkspaceSummary;
  overview: WorkspaceOverview | undefined;
  myId: string;
  live: boolean;
  signals: TileSignals;
  /** The page's stagger index, as `--i`. */
  style?: CSSProperties;
  onDelete: (password: string) => Promise<void>;
}) {
  const [pulse, setPulse] = useState(0);
  const { presence, state } = useRealtime(
    live ? workspace.id : null,
    null,
    (event) => {
      setPulse((n) => n + 1);
      signals.onEvent(event);
    },
    { refetchOnReady: false },
  );

  // Reported up so the hero can count everyone here, once each.
  useEffect(() => {
    if (live) signals.onPresence(workspace.id, presence, state);
  }, [live, presence, state, workspace.id, signals]);
  // And taken back when it stops listening: deleted, or past the live cap.
  useEffect(() => {
    if (!live) return;
    return () => signals.onGone(workspace.id);
  }, [live, workspace.id, signals]);

  const here = new Set(presence.filter((u) => u.userId !== myId).map((u) => u.userId));
  const accent = resolveTheme(workspace.theme).tokens.accent;

  return (
    <li
      onPointerMove={trackSpotlight}
      style={{ ...style, '--tile-accent': accent } as CSSProperties}
      className="home-tile group relative isolate flex flex-col overflow-hidden rounded-2xl border border-line bg-raised/70 p-5 transition-[border-color,transform] duration-300 [transition-timing-function:var(--ease)] focus-within:border-[rgb(var(--tile-accent)/0.6)] hover:-translate-y-0.5 hover:border-[rgb(var(--tile-accent)/0.45)]"
    >
      <span aria-hidden="true" className="home-tile-spot" />
      {pulse > 0 && <span aria-hidden="true" key={pulse} className="home-tile-pulse" />}

      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/workspaces/${workspace.id}`}
          className="min-w-0 rounded-sm text-lg font-semibold tracking-tight text-content outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-[rgb(var(--tile-accent))]"
        >
          <span className="block truncate">{workspace.name}</span>
        </Link>
        <RoleBadge role={workspace.role} />
      </div>

      <div className="mt-6 flex items-end justify-between gap-4">
        <div>
          <div className="text-4xl font-semibold leading-none text-content">
            {overview ? (
              <LiveNumber value={overview.openIssues} />
            ) : (
              <span className="text-faint">-</span>
            )}
          </div>
          <div className="mt-1.5 text-xs text-muted">open issues</div>
        </div>
        <div className="relative z-10">
          <ActivitySpark days={overview?.activity ?? Array(14).fill(0)} />
        </div>
      </div>

      <TileMembers overview={overview} here={here} />
      <TileLatest overview={overview} />

      <div className="relative z-10 mt-3 flex justify-end">
        <DeleteButton
          allowed={can(workspace.role, 'workspace:delete')}
          kind="workspace"
          name={workspace.name}
          cascade="Every project, issue, document, comment and membership in this workspace is deleted. Other members lose access immediately."
          requiresPassword
          onConfirm={onDelete}
        />
      </div>
    </li>
  );
}

/** A few faces, ringed in the accent when they are here now. */
function TileMembers({
  overview,
  here,
}: {
  overview: WorkspaceOverview | undefined;
  here: ReadonlySet<string>;
}) {
  const count = overview?.memberCount ?? 0;
  const label =
    here.size > 0
      ? `${here.size} here now`
      : overview
        ? `${count} ${count === 1 ? 'member' : 'members'}`
        : '';
  return (
    <div className="mt-5 flex items-center gap-3">
      <div className="flex -space-x-2">
        {(overview?.members ?? []).map((member) => (
          <span
            key={member.id}
            className={`rounded-full ring-2 ${here.has(member.id) ? 'ring-[rgb(var(--tile-accent))]' : 'ring-raised'}`}
            title={here.has(member.id) ? `${member.name}, here now` : member.name}
          >
            <Avatar name={member.name} seed={member.id} avatar={member.avatar} size="sm" />
          </span>
        ))}
      </div>
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}

/** What happened last: who, and on which issue. Blank until the overview loads. */
function TileLatest({ overview }: { overview: WorkspaceOverview | undefined }) {
  const latest = overview?.latest;
  return (
    <p className="mt-4 min-h-5 truncate text-sm text-faint">
      {latest ? (
        <>
          <span className="text-muted">{latest.actorName ?? 'Someone'}</span>{' '}
          {latest.kind === 'comment.created' ? 'commented on' : 'opened'} “{latest.issueTitle}”,{' '}
          {formatRelative(latest.at)}
        </>
      ) : overview ? (
        'Nothing here yet. Open it to start.'
      ) : null}
    </p>
  );
}
