'use client';

import type { PresenceUser, Role } from '@robis/shared';
import Link from 'next/link';
import { NotificationBell } from '../../components/notification-bell.tsx';
import { PresenceBar } from '../../components/presence.tsx';
import { SearchBox } from '../../components/search-box.tsx';
import { Avatar } from '../../components/ui/avatar.tsx';
import { RoleBadge } from '../../components/ui/primitives.tsx';
import type { Me } from '../../lib/api.ts';
import type { ConnectionState } from '../../lib/realtime.ts';
import { PaletteButton } from '../command/palette-button.tsx';

/** Breadcrumb, search, presence, notifications, and the way out to /account. */
export function TopBar({
  workspaceId,
  workspaceName,
  role,
  presence,
  realtimeState,
  userName,
  userId,
  userAvatar,
  here,
  panelOpen,
  onTogglePanel,
}: {
  workspaceId: string;
  workspaceName: string;
  role: Role | undefined;
  presence: PresenceUser[];
  realtimeState: ConnectionState;
  userName: string | null;
  userId: string | null;
  userAvatar: Me['user']['avatar'];
  /** The board on show, so its viewers are marked as here. */
  here?: string | null;
  /** Whether the right-hand panel is out, and the way to change it. */
  panelOpen: boolean;
  onTogglePanel: () => void;
}) {
  return (
    /*
     * Three columns with equal outer tracks, so the search box sits on the
     * true centre of the window whatever the breadcrumb and the right-hand
     * cluster measure. With `ml-auto` it was pushed against the presence
     * avatars and its placeholder was cut off mid-word.
     *
     * Below `md` the search box drops to its own full-width row instead of
     * disappearing: on a phone it is the fastest way to anything that is not
     * in the channel list.
     */
    <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-line bg-raised px-4 py-2 md:grid-cols-[minmax(0,1fr)_minmax(16rem,26rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_minmax(18rem,34rem)_minmax(0,1fr)]">
      {/* Every cell is placed explicitly. Left to auto-placement, the search
          box (the one item with a fixed row) claims the first column. */}
      <nav className="col-start-1 row-start-1 flex min-w-0 items-center gap-2 text-sm">
        {/* On a phone the word "Workspaces" left the workspace's own name
            one letter wide, so it shrinks to a back arrow there. */}
        <Link href="/workspaces" className="shrink-0 text-faint hover:text-muted">
          <span aria-hidden="true" className="sm:hidden">
            ‹
          </span>
          {/* The same word for everyone: hidden visually on a phone, still
              read aloud, so speech and screen-reader users hear the label a
              sighted user sees from `sm` up. */}
          <span className="sr-only sm:not-sr-only">Workspaces</span>
        </Link>
        <span className="hidden text-faint sm:inline">/</span>
        <span className="truncate font-medium text-content">{workspaceName}</span>
        {role ? <RoleBadge role={role} /> : null}
      </nav>

      <div className="col-span-2 col-start-1 row-start-2 md:col-span-1 md:col-start-2 md:row-start-1">
        <SearchBox
          workspaceId={workspaceId}
          trailing={<PaletteButton className="hidden md:flex" />}
        />
      </div>

      <div className="col-start-2 row-start-1 flex min-w-0 items-center justify-end gap-3 md:col-start-3">
        {/* You are already the account avatar beside it. Listing yourself in
            the presence row as well put the same initials in the header
            twice; the count still includes you. */}
        <PresenceBar
          users={presence}
          state={realtimeState}
          excludeUserId={userId}
          here={here ?? undefined}
        />
        <button
          type="button"
          onClick={onTogglePanel}
          aria-pressed={panelOpen}
          title={panelOpen ? 'Hide the side panel' : 'Show docs, meetings, team and activity'}
          className={`hidden rounded px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft lg:inline-flex ${
            panelOpen ? 'bg-accent/15 text-content' : 'text-muted hover:text-content'
          }`}
        >
          Panel
        </button>
        <NotificationBell />

        <Link
          href="/account"
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
          aria-label="Your account"
          title={userName ?? 'Your account'}
        >
          <Avatar name={userName ?? '?'} seed={userId ?? undefined} avatar={userAvatar} size="sm" />
        </Link>
      </div>
    </header>
  );
}
