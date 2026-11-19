'use client';

import { can } from '@robis/shared';
import { AgentList } from '../../../../../components/agent-list.tsx';
import { MemberList } from '../../../../../components/member-list.tsx';
import { PageFrame, useWorkspaceRole } from '../../../../../features/workspace/page-frame.tsx';

/** Who is in the workspace, their roles, invitations, and the agents. */
export default function PeoplePage() {
  const { workspaceId, role } = useWorkspaceRole();

  return (
    <PageFrame
      title="People"
      lead="Members and their roles, invitations, and the agents an admin has added."
    >
      <MemberList workspaceId={workspaceId} viewerRole={role} />
      {role && can(role, 'agent:manage') ? (
        <div className="mt-10">
          <AgentList workspaceId={workspaceId} />
        </div>
      ) : null}
    </PageFrame>
  );
}
