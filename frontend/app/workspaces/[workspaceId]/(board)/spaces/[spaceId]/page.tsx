'use client';

import { useParams } from 'next/navigation';
import { SpaceView } from '../../../../../../features/spaces/space-view.tsx';

/** One space and its threads. */
export default function SpacePage() {
  const { workspaceId, spaceId } = useParams<{ workspaceId: string; spaceId: string }>();
  return <SpaceView workspaceId={workspaceId} spaceId={spaceId} />;
}
