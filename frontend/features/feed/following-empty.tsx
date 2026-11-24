'use client';

import { Avatar } from '../../components/ui/avatar.tsx';
import type { Member } from '../../lib/api.ts';
import { FollowButton } from './follow-button.tsx';

/** Teammates suggested on an empty Following tab. */
const SUGGESTED = 6;

/**
 * An empty Following tab: what it is for, and a few teammates to follow
 * from right here, so it fills without a trip elsewhere.
 */
export function FollowingEmpty({
  workspaceId,
  me,
  members,
  followingAnyone,
}: {
  workspaceId: string;
  me: string | null;
  members: readonly Member[];
  followingAnyone: boolean;
}) {
  const others = members.filter((m) => m.userId !== me).slice(0, SUGGESTED);
  return (
    <div className="rounded-xl border border-dashed border-line px-5 py-6">
      <p className="text-sm font-medium text-content">
        {followingAnyone
          ? 'Nothing new from the people you follow'
          : 'Follow people to see only their posts'}
      </p>
      <p className="mt-1 max-w-[52ch] text-sm text-muted">
        Following keeps this tab to the people whose work you want in front of you. Everyone still
        has the whole workspace.
      </p>
      {others.length > 0 ? (
        <ul className="mt-4 divide-y divide-line">
          {others.map((member) => (
            <li key={member.userId} className="flex items-center gap-3 py-2">
              <Avatar
                name={member.name}
                seed={member.userId}
                avatar={member.avatar ?? null}
                size="sm"
              />
              <span className="min-w-0 flex-1 truncate text-sm text-content">{member.name}</span>
              <FollowButton workspaceId={workspaceId} userId={member.userId} name={member.name} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
