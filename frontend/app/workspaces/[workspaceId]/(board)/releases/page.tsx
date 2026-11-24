'use client';

import { ReleasesView } from '../../../../../features/releases/releases-view.tsx';
import { PageFrame, useWorkspaceRole } from '../../../../../features/workspace/page-frame.tsx';

/** Releases: versions of the work gathered from every board, shipped with notes. */
export default function ReleasesPage() {
  const { workspaceId, role } = useWorkspaceRole();
  return (
    <PageFrame
      title="Releases"
      lead="Versions of the work, gathered from any board. Shipping one stamps it and writes its notes from what was done."
    >
      <ReleasesView workspaceId={workspaceId} role={role} />
    </PageFrame>
  );
}
