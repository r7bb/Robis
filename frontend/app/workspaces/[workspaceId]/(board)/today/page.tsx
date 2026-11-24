'use client';

import { useParams } from 'next/navigation';
import { TodayView } from '../../../../../features/today/today-view.tsx';

/** Today: what is yours to do in this workspace, in one calm list. */
export default function TodayPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  return <TodayView workspaceId={workspaceId} />;
}
