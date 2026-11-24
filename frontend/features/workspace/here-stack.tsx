'use client';

import { Avatar } from '../../components/ui/avatar.tsx';
import { useMemberAvatars } from '../../lib/use-member-avatars.ts';
import { useLive } from './live.tsx';

/** Faces shown beside a board or document; the rest are counted, not drawn. */
const FACES = 3;

/**
 * Who has this board or document open right now, as small overlapping
 * faces beside its name in the sidebar: a glance shows where the team is.
 * You are left out; nothing shows when nobody else is there.
 */
export function HereStack({ location, me }: { location: string; me: string | null }) {
  const { presence } = useLive();
  const avatars = useMemberAvatars();
  const here = presence.filter((user) => user.location === location && user.userId !== me);
  if (here.length === 0) return null;
  const names = here.map((user) => user.name);
  const said =
    names.length === 1
      ? `${names[0]} is here`
      : `${names.slice(0, -1).join(', ')} and ${names.at(-1)} are here`;
  return (
    <span className="flex shrink-0 items-center" title={said}>
      <span className="flex -space-x-1.5" aria-hidden="true">
        {here.slice(0, FACES).map((user) => (
          <span key={user.userId} className="flex rounded-full ring-2 ring-surface">
            <Avatar
              name={user.name}
              seed={user.userId}
              avatar={avatars.get(user.userId) ?? null}
              size="sm"
              className="!h-4 !w-4 !text-[7px]"
            />
          </span>
        ))}
      </span>
      {here.length > FACES ? (
        <span aria-hidden="true" className="ml-1 text-[10px] text-faint">
          +{here.length - FACES}
        </span>
      ) : null}
      <span className="sr-only">{said}</span>
    </span>
  );
}
