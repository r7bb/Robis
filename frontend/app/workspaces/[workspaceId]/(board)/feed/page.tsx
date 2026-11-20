'use client';

import { useParams } from 'next/navigation';
import { FeedView } from '../../../../../features/feed/feed-view.tsx';

/** The workspace's feed (Phase 2c). */
export default function FeedPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  return <FeedView workspaceId={workspaceId} />;
}
