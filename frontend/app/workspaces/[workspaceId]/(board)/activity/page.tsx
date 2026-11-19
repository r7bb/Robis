'use client';

import { can } from '@robis/shared';
import Link from 'next/link';
import { ActivityFeed } from '../../../../../components/activity-feed.tsx';
import { PageFrame, useWorkspaceRole } from '../../../../../features/workspace/page-frame.tsx';

/** What has changed across the workspace, newest first. */
export default function ActivityPage() {
  const { workspaceId, role } = useWorkspaceRole();

  return (
    <PageFrame title="Activity" lead="Changes across the workspace, newest first.">
      {role && can(role, 'audit:read') ? (
        <Link
          href={`/workspaces/${workspaceId}/security`}
          className="inline-block rounded-md text-sm text-accent-soft underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
        >
          The full trail, its chain check and export
        </Link>
      ) : null}
      <ActivityFeed workspaceId={workspaceId} />
    </PageFrame>
  );
}
