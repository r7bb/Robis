'use client';

import { useParams } from 'next/navigation';
import { InsightsView } from '../../../../../features/insights/insights-view.tsx';
import { PageFrame } from '../../../../../features/workspace/page-frame.tsx';

/** How long work takes and how much gets done (Phase 6). */
export default function InsightsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  return (
    <PageFrame
      title="Insights"
      lead="How long work takes and how much gets done, from what has really happened here."
    >
      <InsightsView workspaceId={workspaceId} />
    </PageFrame>
  );
}
