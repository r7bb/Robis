'use client';

import { useParams } from 'next/navigation';
import { WorkspaceShell } from '../../../features/workspace/shell.tsx';

/**
 * The route is a wrapper and nothing else.
 *
 * Everything that was here moved into `features/workspace/shell.tsx`. A page
 * module in Next.js can only export a default component plus a fixed set of
 * config fields, so a 250-line page cannot be split, reused or tested in
 * pieces -- keeping routes thin is what makes the rest of it ordinary code.
 */
export default function WorkspacePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();

  return <WorkspaceShell workspaceId={workspaceId} />;
}
