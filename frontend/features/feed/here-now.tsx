'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { Avatar } from '../../components/ui/avatar.tsx';
import { call, type Member } from '../../lib/api.ts';
import { useLive } from '../workspace/live.tsx';

/**
 * Who is here now, at the top of the feed: the teammates with Robis open,
 * each with a live dot and the board or document they have open, and the workspace's
 * agents, so the feed opens on a team at work rather than a list. Presence
 * is the realtime gateway's own; nothing new is kept about anyone.
 */

const SHOWN = 8;

export function HereNow({
  workspaceId,
  me,
  people,
}: {
  workspaceId: string;
  me: string | null;
  people: ReadonlyMap<string, Member>;
}) {
  const { presence, state } = useLive();
  const projects = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => call(contracts['projects.list'], { params: { workspaceId } }),
  });
  const documents = useQuery({
    queryKey: ['documents', workspaceId],
    queryFn: () => call(contracts['documents.list'], { params: { workspaceId } }),
  });
  // Where each location is, in words: a board's name, or a document's title.
  const placeName = new Map<string, string>([
    ...(projects.data?.projects ?? []).map((p) => [p.id, `on ${p.name}`] as const),
    ...(documents.data?.documents ?? []).map((d) => [d.id, `in ${d.title}`] as const),
  ]);
  const here = presence.filter((user) => user.userId !== me).slice(0, SHOWN);
  const agents = [...people.values()].filter((member) => member.kind === 'agent');
  if (state !== 'live' || (here.length === 0 && agents.length === 0)) return null;

  return (
    <section
      aria-labelledby="here-now-heading"
      className="mt-4 rounded-xl border border-line bg-raised px-4 py-3"
    >
      <h2
        id="here-now-heading"
        className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-faint"
      >
        <span aria-hidden="true" className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        Here now
      </h2>
      <ul className="mt-2.5 flex flex-wrap gap-2">
        {here.map((user) => {
          const where = user.location ? placeName.get(user.location) : undefined;
          const member = people.get(user.userId);
          return (
            <li
              key={user.userId}
              className="flex items-center gap-2 rounded-full bg-surface py-1 pl-1 pr-3 text-xs"
            >
              <span className="relative">
                <Avatar
                  name={user.name}
                  seed={user.userId}
                  avatar={member?.avatar ?? null}
                  size="sm"
                />
                <span
                  aria-hidden="true"
                  className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-surface"
                />
              </span>
              <span className="text-content">{user.name}</span>
              <span className="text-faint">{where ?? 'around'}</span>
            </li>
          );
        })}
        {agents.map((agent) => (
          <li
            key={agent.userId}
            className="flex items-center gap-2 rounded-full bg-accent/10 py-1 pl-1 pr-3 text-xs ring-1 ring-accent/25"
          >
            <Avatar name={agent.name} seed={agent.userId} avatar={agent.avatar ?? null} size="sm" />
            <span className="text-content">{agent.name}</span>
            <span className="text-accent-soft">agent at work</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
