'use client';

import { useParams } from 'next/navigation';
import { SpacesHome } from '../../../../../features/spaces/spaces-home.tsx';

/** Spaces: the workspace's topics for questions, ideas and tips. */
export default function SpacesPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  return <SpacesHome workspaceId={workspaceId} />;
}
