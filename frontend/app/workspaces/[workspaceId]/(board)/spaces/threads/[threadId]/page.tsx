'use client';

import { useParams } from 'next/navigation';
import { ThreadView } from '../../../../../../../features/spaces/thread-view.tsx';

/** A thread in a space, with its replies. */
export default function ThreadPage() {
  const { workspaceId, threadId } = useParams<{ workspaceId: string; threadId: string }>();
  return <ThreadView workspaceId={workspaceId} threadId={threadId} />;
}
