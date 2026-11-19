'use client';

import { can, contracts, type Role, type ThemeId } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ThemePicker } from '../../components/theme-picker.tsx';
import { Avatar } from '../../components/ui/avatar.tsx';
import { AgentBadge, SectionLabel } from '../../components/ui/primitives.tsx';
import { ApiError, call, type Member } from '../../lib/api.ts';
import { boardHref } from '../../lib/links.ts';
import { ChannelList } from '../chat/channel-list.tsx';
import { useCreateChannel } from '../chat/use-chat.ts';

/**
 * The left rail: the boards first, since the board is the middle of the
 * workspace, then the rooms the chat below it can show, then who is here.
 */

/** Each project's board, the one on show marked. */
function ProjectNav({ workspaceId, activeId }: { workspaceId: string; activeId: string | null }) {
  const projects = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => call(contracts['projects.list'], { params: { workspaceId } }),
  });
  const rows = (projects.data?.projects ?? []).filter((project) => !project.archived);

  return (
    <section className="space-y-2">
      <SectionLabel>Boards</SectionLabel>
      {projects.isSuccess && rows.length === 0 ? (
        <p className="px-2 text-xs text-faint">No projects yet.</p>
      ) : (
        <ul className="space-y-px">
          {rows.map((project) => {
            const active = project.id === activeId;
            return (
              <li key={project.id}>
                <Link
                  href={boardHref(workspaceId, project.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center justify-between gap-2 rounded px-2 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${
                    active
                      ? 'bg-accent/15 text-content'
                      : 'text-muted hover:bg-surface hover:text-content'
                  }`}
                >
                  <span className="truncate">{project.name}</span>
                  <span className="shrink-0 font-mono text-[10px] text-faint">{project.key}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Who is in the workspace, and who is here right now. A Set of online ids,
 * so each row is one lookup rather than a scan of the presence list.
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
                <Avatar name={member.name} seed={member.userId} avatar={member.avatar} size="sm" />
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
              {member.kind === 'agent' && <AgentBadge />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function Sidebar({
  workspaceId,
  projectId,
  role,
  rooms,
  channelId,
  onSelectChannel,
  members,
  onlineIds,
  theme,
}: {
  workspaceId: string;
  projectId: string | null;
  role: Role | undefined;
  rooms: { id: string; name: string; topic: string | null }[];
  channelId: string | null;
  onSelectChannel: (id: string) => void;
  members: Member[];
  onlineIds: Set<string>;
  theme: ThemeId;
}) {
  const createChannel = useCreateChannel(workspaceId);

  return (
    // A 224px rail on a 390px phone left the board about 160px; below `md`
    // the boards and rooms move into strips instead.
    <nav className="hidden w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line bg-raised p-3 md:flex">
      <ProjectNav workspaceId={workspaceId} activeId={projectId} />

      <ChannelList
        channels={rooms}
        activeId={channelId}
        onSelect={onSelectChannel}
        canCreate={role !== undefined && can(role, 'channel:create')}
        creating={createChannel.isPending}
        createError={createChannel.error instanceof ApiError ? createChannel.error.message : null}
        onCreate={(name) =>
          createChannel.mutate(name, {
            // Straight into the room just made: the reason for making it is
            // to say something in it.
            onSuccess: (created) => onSelectChannel(created.channel.id),
          })
        }
      />

      <TeamRoster members={members} onlineIds={onlineIds} />

      {role ? (
        // Collapsed: six labelled buttons is most of the rail, spent on
        // something changed once per workspace.
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
  );
}
