'use client';

import { contracts, resolveTheme, type Scope, type ServerEvent } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { useParams, usePathname } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorState } from '../../components/ui/primitives.tsx';
import { call, type Member } from '../../lib/api.ts';
import { useRealtime } from '../../lib/realtime.ts';
import { lastTheme, rememberTheme, useApplyTheme } from '../../lib/theme.ts';
import { useRequireAvatar } from '../../lib/use-require-avatar.ts';
import { useChannels } from '../chat/use-chat.ts';
import { ChatPanel } from './chat-panel.tsx';
import { type Live, LiveProvider } from './live.tsx';
import { Sidebar } from './sidebar.tsx';
import { TopBar } from './top-bar.tsx';
import { useChatPanel } from './use-chat-panel.ts';
import { useOpenRoom } from './use-open-room.ts';

/**
 * The workspace, in three parts and each thing in one place: where things
 * are on the left (boards, docs, and the way to meetings, activity and
 * people), the board or page in the middle, and the chat on the right with
 * its rooms and the team at its top.
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

function avatarsOf(members: Member[] | undefined) {
  return new Map((members ?? []).map((member) => [member.userId, member.avatar]));
}

/** The one live connection, and a way for the board to hear it. */
function useFrameLive(workspaceId: string, projectId: string | null, channelId: string | null) {
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
  return useMemo<Live>(() => ({ presence, state, subscribe }), [presence, state, subscribe]);
}

export function WorkspaceFrame({ children }: { children: ReactNode }) {
  const { workspaceId, projectId = null } = useParams<{
    workspaceId: string;
    projectId?: string;
  }>();
  const pathname = usePathname();

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
  const live = useFrameLive(workspaceId, projectId, channelId);

  const chat = useChatPanel();
  const { setOpen: setChatOpen } = chat;
  // A room asked for (the palette, or chosen in the chat) is shown.
  useEffect(() => {
    if (askedAt) setChatOpen(true);
  }, [askedAt, setChatOpen]);

  // The phone's drawer closes once it has taken you somewhere.
  const [menuOpen, setMenuOpen] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on each new address
  useEffect(() => setMenuOpen(false), [pathname]);

  // The last theme seen until this one loads, so moving between workspaces
  // does not flash the default.
  const theme = resolveTheme(workspace.data?.workspace.theme ?? lastTheme()).id;
  useApplyTheme(theme);
  rememberTheme(workspace.data?.workspace.theme);
  const avatarsById = useMemo(() => avatarsOf(members.data?.members), [members.data]);
  const onlineIds = useMemo(
    () => new Set(live.presence.map((user) => user.userId)),
    [live.presence],
  );

  if (workspace.isError) return <ErrorState message={(workspace.error as Error).message} />;

  const role = workspace.data?.workspace.role;

  return (
    // `h-dvh`, not `h-screen`: on mobile Safari 100vh includes the browser's
    // own bars, and the message box would sit below the fold.
    <LiveProvider value={live}>
      <div className="flex h-dvh flex-col overflow-hidden bg-surface">
        <a
          href="#main"
          className="sr-only rounded-md bg-accent px-3 py-1.5 text-sm text-accent-contrast focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50"
        >
          Skip to the main content
        </a>
        <TopBar
          workspaceId={workspaceId}
          workspaceName={workspace.data?.workspace.name ?? '…'}
          role={role}
          userName={me.data?.user.name ?? null}
          userId={me.data?.user.id ?? null}
          userAvatar={me.data?.user.avatar ?? null}
          chatOpen={chat.open}
          onToggleChat={() => chat.setOpen(!chat.open)}
          menuOpen={menuOpen}
          onOpenMenu={() => setMenuOpen(true)}
        />

        <div className="flex min-h-0 flex-1">
          <Sidebar
            workspaceId={workspaceId}
            projectId={projectId}
            role={role}
            theme={theme}
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
          />

          <main
            id="main"
            tabIndex={-1}
            className="min-h-0 min-w-0 flex-1 overflow-auto outline-none"
          >
            {children}
          </main>

          {role ? (
            <ChatPanel
              workspaceId={workspaceId}
              panel={chat}
              rooms={rooms}
              channel={rooms.find((room) => room.id === channelId) ?? null}
              onSelect={choose}
              role={role}
              currentUserId={me.data?.user.id ?? null}
              avatars={avatarsById}
              members={members.data?.members ?? []}
              onlineIds={onlineIds}
            />
          ) : null}
        </div>
      </div>
    </LiveProvider>
  );
}
