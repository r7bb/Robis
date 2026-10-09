'use client';

import type { PresenceUser } from '@robis/shared';
import type { ConnectionState } from '../lib/realtime.ts';
import { Avatar } from './ui/avatar.tsx';

/*
 * This file used to carry its own palette, hash and initials function, which
 * had already drifted from the shared `Avatar`: it took the first and last
 * word of a name where `Avatar` takes the first two, so "Mary Jane Watson"
 * appeared as MW in the presence bar and MJ everywhere else. Same person,
 * two faces. One implementation now.
 */

/** "Ada Lovelace" or "Ada Lovelace, viewing this board". */
function describe(user: PresenceUser, here: string | null | undefined): string {
  return here && user.location === here ? `${user.name}, viewing this board` : user.name;
}

export function PresenceBar({
  users,
  state,
  /** When set, users reporting this location get a "here" ring. */
  here,
  /** Left out of the avatars, but still counted, when shown elsewhere already. */
  excludeUserId,
}: {
  users: PresenceUser[];
  state: ConnectionState;
  here?: string | null;
  excludeUserId?: string | null;
}) {
  const shown = excludeUserId ? users.filter((user) => user.userId !== excludeUserId) : users;

  // With yourself left out and nobody else here, "1 online" beside no
  // avatars reads like a glitch. Say what it means.
  const alone = Boolean(excludeUserId) && users.length > 0 && shown.length === 0;

  const label =
    state === 'live'
      ? alone
        ? 'Just you'
        : `${users.length} online`
      : state === 'connecting'
        ? 'Connecting…'
        : 'Reconnecting…';

  return (
    <div className="flex items-center gap-3">
      <div className="flex -space-x-2">
        {shown.map((user) => (
          // `Avatar` renders initials and is `aria-hidden`, so the name is
          // carried by the wrapper: a tooltip for a mouse, and text for a
          // screen reader, which a bare `title` would not reliably give.
          <span key={user.userId} title={describe(user, here)}>
            <Avatar
              name={user.name}
              seed={user.userId}
              size="md"
              // The ring marks somebody as looking at this very board. It
              // stays here rather than moving into `Avatar`, because it is a
              // fact about presence, not about the person.
              className={`ring-2 ${
                here && user.location === here ? 'ring-emerald-400' : 'ring-surface'
              }`}
            />
            <span className="sr-only">{describe(user, here)}</span>
          </span>
        ))}
      </div>

      <span className="flex items-center gap-1.5 text-xs text-faint">
        <span
          aria-hidden
          className={[
            'h-1.5 w-1.5 rounded-full',
            state === 'live'
              ? 'bg-emerald-400'
              : state === 'connecting'
                ? 'bg-amber-400'
                : 'bg-faint',
          ].join(' ')}
        />
        {label}
      </span>
    </div>
  );
}
