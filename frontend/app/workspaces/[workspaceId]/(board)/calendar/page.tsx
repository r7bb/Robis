'use client';

import { useParams } from 'next/navigation';
import { WeekView } from '../../../../../features/calendar/week-view.tsx';
import { PageFrame } from '../../../../../features/workspace/page-frame.tsx';
import { useT } from '../../../../../lib/i18n/locale-context.tsx';

/** The week (B8): meetings in your own time zone, and what is due each day. */
export default function CalendarPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { t } = useT();
  return (
    <PageFrame wide title={t('calendar.title')} lead={t('calendar.lead')}>
      <WeekView workspaceId={workspaceId} />
    </PageFrame>
  );
}
