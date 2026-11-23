'use client';

import type { Role } from '@robis/shared';
import Link from 'next/link';
import { NotificationBell } from '../../components/notification-bell.tsx';
import { SearchBox } from '../../components/search-box.tsx';
import { Avatar } from '../../components/ui/avatar.tsx';
import { Kbd } from '../../components/ui/kbd.tsx';
import { DemoBadge, RoleBadge } from '../../components/ui/primitives.tsx';
import type { Me } from '../../lib/api.ts';
import { PaletteButton } from '../command/palette-button.tsx';

/** Breadcrumb, search, notifications, and the way out to /account. */
export function TopBar({
  workspaceId,
  workspaceName,
  role,
  demo,
  userName,
  userId,
  userAvatar,
  chatOpen,
  onToggleChat,
  menuOpen,
  onOpenMenu,
  focusOn,
  onToggleFocus,
}: {
  workspaceId: string;
  workspaceName: string;
  role: Role | undefined;
  /** A demo workspace (C5), labelled as one. */
  demo: boolean;
  userName: string | null;
  userId: string | null;
  userAvatar: Me['user']['avatar'];
  /** Whether the chat is out; when it is not, a button brings it back. */
  chatOpen: boolean;
  onToggleChat: () => void;
  /** On a phone: the left rail as a drawer, and the way to open it. */
  menuOpen: boolean;
  onOpenMenu: () => void;
  /** Focus mode: the rails put away; the backslash key turns it too. */
  focusOn: boolean;
  onToggleFocus: () => void;
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
      <nav
        aria-label="Breadcrumb"
        className="col-start-1 row-start-1 flex min-w-0 items-center gap-2 text-sm"
      >
        <button
          type="button"
          data-menu-toggle
          aria-expanded={menuOpen}
          aria-controls="workspace-menu"
          onClick={onOpenMenu}
          className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-muted transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft md:hidden"
        >
          Menu
        </button>
        {/* On a phone the word "Workspaces" left the workspace's own name
            one letter wide, so it shrinks to a back arrow there. */}
        <Link
          href="/workspaces"
          className="shrink-0 rounded text-faint hover:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
        >
          <span aria-hidden="true" className="sm:hidden">
            ‹
          </span>
          {/* The same word for everyone: hidden visually on a phone, still
              read aloud, so speech and screen-reader users hear the label a
              sighted user sees from `sm` up. */}
          <span className="sr-only sm:not-sr-only">Workspaces</span>
        </Link>
        <span aria-hidden="true" className="hidden text-faint sm:inline">
          /
        </span>
        <span className="truncate font-medium text-content">{workspaceName}</span>
        {role ? <RoleBadge role={role} /> : null}
        {demo ? <DemoBadge /> : null}
      </nav>

      <div className="col-span-2 col-start-1 row-start-2 md:col-span-1 md:col-start-2 md:row-start-1">
        <SearchBox
          workspaceId={workspaceId}
          trailing={<PaletteButton className="hidden md:flex" />}
        />
      </div>

      <div className="col-start-2 row-start-1 flex min-w-0 items-center justify-end gap-3 md:col-start-3">
        {/* Who is here is shown once, at the top of the chat; this only
            brings the chat back when it is hidden. */}
        <button
          type="button"
          onClick={onToggleFocus}
          aria-pressed={focusOn}
          title={focusOn ? 'Leave focus mode (\\)' : 'Focus mode: hide the side panels (\\)'}
          className={`hidden items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft md:inline-flex ${
            focusOn ? 'bg-accent/15 text-content' : 'text-muted hover:bg-surface hover:text-content'
          }`}
        >
          Focus
          <Kbd>{'\\'}</Kbd>
        </button>
        {chatOpen ? null : (
          <button
            type="button"
            data-chat-toggle
            onClick={onToggleChat}
            title="Show chat (Ctrl `)"
            className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-surface hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
          >
            Chat
          </button>
        )}
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
