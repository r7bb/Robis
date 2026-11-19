'use client';

import { contracts, resolveTheme, type Scope, type ServerEvent } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorState } from '../../components/ui/primitives.tsx';
import { call, type Member } from '../../lib/api.ts';
import { boardHref, CHANNEL_PARAM } from '../../lib/links.ts';
import { useRealtime } from '../../lib/realtime.ts';
import { lastTheme, rememberTheme, useApplyTheme } from '../../lib/theme.ts';
import { useRequireAvatar } from '../../lib/use-require-avatar.ts';
import { useChannels } from '../chat/use-chat.ts';
import { ChatDock } from './chat-dock.tsx';
import { type Live, LiveProvider } from './live.tsx';
import { SidePanel } from './side-panel.tsx';
import { Sidebar } from './sidebar.tsx';
import { TopBar } from './top-bar.tsx';

/**
 * The workspace: the board in the middle, chat docked under it like a
 * terminal, the boards, rooms and people on the left, and everything else
 * in the tabbed rail on the right.
 *
 * A layout, so moving from one board to another keeps the frame, the open
 * room and the one live connection; only the middle changes.
 */

/** What the frame shows: the workspace, the board on show and the open room. */
function frameScopes(projectId: string | null, channelId: string | null): Scope[] {
  return [
    { kind: 'workspace' },
    ...(projectId ? [{ kind: 'project' as const, projectId }] : []),
    ...(channelId ? [{ kind: 'channel' as const, channelId }] : []),
  ];
}

/** Out by itself only where the board still has room beside it. */
const WIDE_ENOUGH = '(min-width: 1536px)';

function useSidePanel() {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(window.matchMedia(WIDE_ENOUGH).matches), []);
  const toggle = useCallback(() => setOpen((was) => !was), []);
  return { open, toggle };
}

function avatarsOf(members: Member[] | undefined) {
  return new Map((members ?? []).map((member) => [member.userId, member.avatar]));
}

/**
 * Which room is open: one named in the address (the palette's channels),
 * once it is known to be one of this workspace's; otherwise the one already
 * open while it exists; otherwise `general`, the room every workspace
 * starts with. The address then drops the name, so choosing it again works.
 */
/** `general`, the room every workspace starts with, or else the first. */
function landingRoom(rooms: { id: string; name: string }[]): string {
  return (rooms.find((room) => room.name === 'general') ?? rooms[0]!).id;
}

/** This address without the room in it: a board's filters stay. */
function withoutRoom(pathname: string): string {
  const rest = new URLSearchParams(window.location.search);
  rest.delete(CHANNEL_PARAM);
  const query = rest.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function useOpenRoom(rooms: { id: string; name: string }[]) {
  const [channelId, setChannelId] = useState<string | null>(null);
  // Bumped whenever a room is chosen, so the dock opens to show it.
  const [askedAt, setAskedAt] = useState<string | null>(null);
  const asked = useSearchParams().get(CHANNEL_PARAM);
  // The room last taken from the address, so it is taken once: choosing it
  // re-runs this effect before the address has caught up.
  const taken = useRef<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  const choose = useCallback((id: string) => {
    setChannelId(id);
    setAskedAt(`${id}:${Date.now()}`);
  }, []);

  useEffect(() => {
    if (rooms.length === 0) return;
    if (!asked) {
      taken.current = null;
      if (!channelId || !rooms.some((room) => room.id === channelId)) {
        setChannelId(landingRoom(rooms));
      }
      return;
    }
    if (asked !== taken.current) {
      taken.current = asked;
      if (rooms.some((room) => room.id === asked)) choose(asked);
    }
    router.replace(withoutRoom(pathname), { scroll: false });
  }, [rooms, channelId, asked, router, pathname, choose]);

  return { channelId, choose, askedAt };
}

/** The boards as a row of links, for screens too narrow for the left rail. */
function BoardStrip({ workspaceId, projectId }: { workspaceId: string; projectId: string | null }) {
  const projects = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => call(contracts['projects.list'], { params: { workspaceId } }),
  });
  const rows = (projects.data?.projects ?? []).filter((project) => !project.archived);
  if (rows.length < 2) return null;

  return (
    <nav
      aria-label="Boards"
      className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-line bg-raised px-3 py-2 md:hidden"
    >
      {rows.map((project) => (
        <Link
          key={project.id}
          href={boardHref(workspaceId, project.id)}
          aria-current={project.id === projectId ? 'page' : undefined}
          className={`shrink-0 rounded-full px-3 py-1 text-sm transition-colors ${
            project.id === projectId
              ? 'bg-accent/15 text-content'
              : 'text-faint hover:bg-surface hover:text-muted'
          }`}
        >
          {project.name}
        </Link>
      ))}
    </nav>
  );
}

export function WorkspaceFrame({ children }: { children: ReactNode }) {
  const { workspaceId, projectId = null } = useParams<{
    workspaceId: string;
    projectId?: string;
  }>();

  const workspace = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => call(contracts['workspaces.get'], { params: { workspaceId } }),
  });
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => call(contracts['auth.me']),
    retry: false,
  });
  useRequireAvatar(me.data);
  const members = useQuery({
    queryKey: ['members', workspaceId],
    queryFn: () => call(contracts['members.list'], { params: { workspaceId } }),
  });

  const channels = useChannels(workspaceId);
  const rooms = channels.data?.channels ?? [];
  const { channelId, choose, askedAt } = useOpenRoom(rooms);

  // One socket for the frame: the board's events go to whoever listens.
  const listeners = useRef(new Set<(event: ServerEvent) => void>());
  const { presence, state } = useRealtime(
    workspaceId,
    projectId,
    (event) => {
      for (const listener of listeners.current) listener(event);
    },
    { scopes: frameScopes(projectId, channelId) },
  );
  const subscribe = useCallback((listener: (event: ServerEvent) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  const live: Live = useMemo(() => ({ presence, state, subscribe }), [presence, state, subscribe]);

  // The last theme seen until this one loads, so moving between workspaces
  // does not flash the default.
  const theme = resolveTheme(workspace.data?.workspace.theme ?? lastTheme()).id;
  useApplyTheme(theme);
  rememberTheme(workspace.data?.workspace.theme);
  const avatarsById = useMemo(() => avatarsOf(members.data?.members), [members.data]);
  const panel = useSidePanel();

  if (workspace.isError) return <ErrorState message={(workspace.error as Error).message} />;

  const role = workspace.data?.workspace.role;
  const currentUserId = me.data?.user.id ?? null;
  const onlineIds = new Set(presence.map((user) => user.userId));

  return (
    // `h-dvh`, not `h-screen`: on mobile Safari 100vh includes the browser's
    // own bars, and the message box would sit below the fold.
    <LiveProvider value={live}>
      <div className="flex h-dvh flex-col overflow-hidden bg-surface">
        <TopBar
          workspaceId={workspaceId}
          workspaceName={workspace.data?.workspace.name ?? '…'}
          role={role}
          presence={presence}
          realtimeState={state}
          userName={me.data?.user.name ?? null}
          userId={currentUserId}
          userAvatar={me.data?.user.avatar ?? null}
          here={projectId}
          panelOpen={panel.open}
          onTogglePanel={panel.toggle}
        />

        <div className="flex min-h-0 flex-1">
          <Sidebar
            workspaceId={workspaceId}
            projectId={projectId}
            role={role}
            rooms={rooms}
            channelId={channelId}
            onSelectChannel={choose}
            members={members.data?.members ?? []}
            onlineIds={onlineIds}
            theme={theme}
          />

          <div className="flex min-w-0 flex-1 flex-col">
            <BoardStrip workspaceId={workspaceId} projectId={projectId} />
            <main className="min-h-0 flex-1 overflow-auto">{children}</main>
            {role ? (
              <ChatDock
                workspaceId={workspaceId}
                rooms={rooms}
                channel={rooms.find((room) => room.id === channelId) ?? null}
                onSelect={choose}
                role={role}
                currentUserId={currentUserId}
                avatars={avatarsById}
                openWhen={askedAt}
              />
            ) : null}
          </div>

          {role && panel.open ? (
            <div className="hidden lg:flex">
              <SidePanel
                workspaceId={workspaceId}
                role={role}
                members={members.data?.members ?? []}
                currentUserId={currentUserId}
              />
            </div>
          ) : null}
        </div>
      </div>
    </LiveProvider>
  );
}
