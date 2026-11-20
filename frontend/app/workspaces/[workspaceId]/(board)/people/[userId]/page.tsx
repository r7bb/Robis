'use client';

import { useParams } from 'next/navigation';
import { ProfileView } from '../../../../../../features/profiles/profile-view.tsx';

/** A member's profile in this workspace (B2). */
export default function PersonPage() {
  const { workspaceId, userId } = useParams<{ workspaceId: string; userId: string }>();
  return <ProfileView workspaceId={workspaceId} userId={userId} />;
}
