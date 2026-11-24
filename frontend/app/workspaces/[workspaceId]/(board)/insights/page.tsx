'use client';

import { can } from '@robis/shared';
import { HealthSection } from '../../../../../features/insights/health-view.tsx';
import { InsightsView } from '../../../../../features/insights/insights-view.tsx';
import { WorkloadSection } from '../../../../../features/insights/workload-view.tsx';
import { PageFrame, useWorkspaceRole } from '../../../../../features/workspace/page-frame.tsx';

/** How long work takes and how much gets done, and for admins how the server runs (Phase 6). */
export default function InsightsPage() {
  const { workspaceId, role } = useWorkspaceRole();
  return (
    <PageFrame
      title="Insights"
      lead="How long work takes, how much gets done and who is carrying what, from what has really happened here."
    >
      <InsightsView workspaceId={workspaceId} />
      <WorkloadSection workspaceId={workspaceId} />
      {role && can(role, 'health:read') ? <HealthSection workspaceId={workspaceId} /> : null}
    </PageFrame>
  );
}
