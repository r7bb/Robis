'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { MeetingsPanel } from '../../../../../features/meetings/meetings-panel.tsx';
import { PageFrame, useWorkspaceRole } from '../../../../../features/workspace/page-frame.tsx';
import { call } from '../../../../../lib/api.ts';

/** The workspace's meetings, in the middle, with the chat still beside them. */
export default function MeetingsPage() {
  const { workspaceId, role } = useWorkspaceRole();
  const members = useQuery({
    queryKey: ['members', workspaceId],
    queryFn: () => call(contracts['members.list'], { params: { workspaceId } }),
  });
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => call(contracts['auth.me']),
    retry: false,
  });

  return (
    <PageFrame title="Meetings" lead="What is coming up, who is in it, and the agenda.">
      {role ? (
        <MeetingsPanel
          workspaceId={workspaceId}
          role={role}
          members={members.data?.members ?? []}
          currentUserId={me.data?.user.id ?? null}
        />
      ) : (
        <p className="text-sm text-faint">Loading…</p>
      )}
    </PageFrame>
  );
}
