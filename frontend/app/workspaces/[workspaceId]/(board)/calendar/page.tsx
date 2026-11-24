'use client';

import { useParams } from 'next/navigation';
import { WeekView } from '../../../../../features/calendar/week-view.tsx';
import { PageFrame } from '../../../../../features/workspace/page-frame.tsx';

/** The week (B8): meetings in your own time zone, and what is due each day. */
export default function CalendarPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  return (
    <PageFrame
      wide
      title="Calendar"
      lead="This workspace's meetings and due dates, week by week, in your own time zone."
    >
      <WeekView workspaceId={workspaceId} />
    </PageFrame>
  );
}
