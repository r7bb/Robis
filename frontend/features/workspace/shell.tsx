'use client';

import { can, type PresenceUser, type Role } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { NotificationBell } from '../../components/notification-bell.tsx';
import { PresenceBar } from '../../components/presence.tsx';
import { SearchBox } from '../../components/search-box.tsx';
import { ThemePicker } from '../../components/theme-picker.tsx';
import { Avatar } from '../../components/ui/avatar.tsx';
import { ErrorState, RoleBadge, SectionLabel } from '../../components/ui/primitives.tsx';
import { ApiError, api, type Me, type Member, type WorkspaceSummary } from '../../lib/api.ts';
import { type ConnectionState, useRealtime } from '../../lib/realtime.ts';
import { lastTheme, rememberTheme, useApplyTheme } from '../../lib/theme.ts';
import { ChannelList } from '../chat/channel-list.tsx';
import { ChatView } from '../chat/chat-view.tsx';
import { useChannels, useCreateChannel } from '../chat/use-chat.ts';
import { SidePanel } from './side-panel.tsx';

/** Breadcrumb, search, presence, notifications, and the way out to /account. */
function TopBar({
  workspaceId,
  workspaceName,
  role,
  presence,
  realtimeState,
  userName,
  userId,
}: {
  workspaceId: string;
  workspaceName: string;
  role: Role | undefined;
  presence: PresenceUser[];
  realtimeState: ConnectionState;
  userName: string | null;
  userId: string | null;
}) {
  return (
    <header className="flex shrink-0 items-center gap-4 border-b border-line bg-raised px-4 py-2">
      <nav className="flex min-w-0 items-center gap-2 text-sm">
        <Link href="/workspaces" className="shrink-0 text-faint hover:text-muted">
          Workspaces
        </Link>
        <span className="text-faint">/</span>
        <span className="truncate font-medium text-content">{workspaceName}</span>
        {role ? <RoleBadge role={role} /> : null}
      </nav>

      <div className="ml-auto flex min-w-0 items-center gap-3">
        {/* Hidden rather than wrapped on a narrow screen: the breadcrumb and
            presence matter more than search at that width. */}
        <div className="hidden w-64 md:block">
          <SearchBox workspaceId={workspaceId} />
        </div>

        <PresenceBar users={presence} state={realtimeState} />
        <NotificationBell />

        <Link
          href="/account"
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
          aria-label="Your account"
          title={userName ?? 'Your account'}
        >
          <Avatar name={userName ?? '?'} seed={userId ?? undefined} size="sm" />
        </Link>
      </div>
    </header>
  );
}

/**
 * Who is in the workspace, and who is here right now.
 *
 * Takes a Set of online ids rather than the presence array so the lookup is
 * O(1) per member instead of a scan per row -- with both lists in the
 * hundreds the nested version is the kind of quadratic that only shows up
 * once a workspace gets big.
 */
function TeamRoster({ members, onlineIds }: { members: Member[]; onlineIds: Set<string> }) {
  return (
    <section className="space-y-2">
      <SectionLabel>Team</SectionLabel>

      <ul className="space-y-px">
        {members.map((member) => {
          const online = onlineIds.has(member.userId);

          return (
            <li key={member.userId} className="flex items-center gap-2 rounded px-2 py-1 text-sm">
              <span className="relative">
                <Avatar name={member.name} seed={member.userId} size="sm" />
                {/* A ring in the surface colour cuts the dot out of the
                    avatar, so it reads as a badge rather than a smudge. */}
                {online ? (
                  <span
                    className="absolute -bottom-px -right-px h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-raised"
                    aria-hidden="true"
                  />
                ) : null}
              </span>

              <span
                className={`truncate ${online ? 'text-content' : 'text-faint'}`}
                title={online ? `${member.name} (online)` : member.name}
              >
                {member.name}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The workspace.
 *
 * Three columns: rooms and people on the left, the conversation in the
 * middle, everything else in a tabbed rail on the right. The previous
 * version was a single scrolling page, which meant chat could not exist --
 * there was no column for it that did not push the projects off screen.
 *
 * The shell owns which channel is selected and nothing else. Each panel
 * fetches its own data, so opening one costs a request and closing it stops
 * the polling; hoisting all of it here would load five panels' worth of data
 * to show one.
 */
export function WorkspaceShell({ workspaceId }: { workspaceId: string }) {
  const [channelId, setChannelId] = useState<string | null>(null);

  const workspace = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => api<{ workspace: WorkspaceSummary }>(`/workspaces/${workspaceId}`),
  });

  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false });

  const members = useQuery({
    queryKey: ['members', workspaceId],
    queryFn: () => api<{ members: Member[] }>(`/workspaces/${workspaceId}/members`),
  });

  const channels = useChannels(workspaceId);
  const createChannel = useCreateChannel(workspaceId);

  // No location: on the workspace shell you are "in the workspace", not in a
  // particular project.
  const { presence, state: realtimeState } = useRealtime(workspaceId, null);

  const rooms = channels.data?.channels ?? [];

  /*
   * Land in a room rather than on an empty column.
   *
   * Re-checked on every change rather than set once, because the selected
   * channel can stop existing -- an admin deletes it, or the list arrives
   * after a reconnect without it. Falling back to the first room keeps the
   * centre column from going blank with no explanation.
   */
  useEffect(() => {
    if (rooms.length === 0) return;
    if (channelId && rooms.some((room) => room.id === channelId)) return;

    // Prefer the room every workspace is created with. The list is sorted by
    // name, so without this the landing room is whatever sorts first, and a
    // channel called `#api` would quietly become the front page.
    const fallback = rooms.find((room) => room.name === 'general') ?? rooms[0]!;
    setChannelId(fallback.id);
  }, [rooms, channelId]);

  // Fall back to the last theme seen so navigating between workspaces does
  // not flash the default while this one loads.
  const theme = workspace.data?.workspace.theme ?? lastTheme();
  useApplyTheme(theme);
  rememberTheme(workspace.data?.workspace.theme);

  if (workspace.isError) {
    return <ErrorState message={(workspace.error as Error).message} />;
  }

  const role = workspace.data?.workspace.role;
  const currentUserId = me.data?.user.id ?? null;
  const activeChannel = rooms.find((room) => room.id === channelId) ?? null;
  const onlineIds = new Set(presence.map((user) => user.userId));

  return (
    // `h-dvh` rather than `h-screen`: on mobile Safari `100vh` includes the
    // browser chrome, so the composer sits below the fold until you scroll.
    <div className="flex h-dvh flex-col overflow-hidden bg-surface">
      <TopBar
        workspaceId={workspaceId}
        workspaceName={workspace.data?.workspace.name ?? '…'}
        role={role}
        presence={presence}
        realtimeState={realtimeState}
        userName={me.data?.user.name ?? null}
        userId={currentUserId}
      />

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line bg-raised p-3">
          <ChannelList
            channels={rooms}
            activeId={channelId}
            onSelect={setChannelId}
            canCreate={role !== undefined && can(role, 'channel:create')}
            creating={createChannel.isPending}
            createError={
              createChannel.error instanceof ApiError ? createChannel.error.message : null
            }
            onCreate={(name) =>
              createChannel.mutate(name, {
                // Jump straight into the room that was just made -- the
                // reason for making it is to say something in it.
                onSuccess: (created) => setChannelId(created.channel.id),
              })
            }
          />

          <TeamRoster members={members.data?.members ?? []} onlineIds={onlineIds} />

          {role ? (
            // Collapsed by default. The picker is six labelled buttons, which
            // is most of a 224px sidebar spent on something changed once per
            // workspace and then never again.
            <details className="mt-auto border-t border-line pt-3">
              <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-wider text-faint transition-colors hover:text-muted">
                Theme
              </summary>

              <div className="mt-2">
                <ThemePicker
                  workspaceId={workspaceId}
                  current={theme}
                  canEdit={can(role, 'workspace:update')}
                />
              </div>
            </details>
          ) : null}
        </nav>

        {role ? (
          <ChatView
            workspaceId={workspaceId}
            channel={activeChannel}
            role={role}
            currentUserId={currentUserId}
          />
        ) : (
          <div className="flex-1" />
        )}

        {role ? (
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
  );
}
