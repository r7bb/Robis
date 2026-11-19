'use client';

import { useParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { ProjectBoard } from '../../../../../../features/board/project-board.tsx';
import { rememberBoard } from '../../../../../../lib/last-board.ts';

/**
 * A project's board, in the middle of the workspace frame. Remembered, so
 * coming back to the workspace opens it again. `useSearchParams` (the
 * board's filters) needs a boundary so the route can still be prerendered.
 */
export default function BoardPage() {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();

  useEffect(() => rememberBoard(workspaceId, projectId), [workspaceId, projectId]);

  return (
    <Suspense fallback={<p className="px-6 py-6 text-sm text-faint">Loading…</p>}>
      {/* Keyed, so another board starts clean rather than with this one's state. */}
      <ProjectBoard key={projectId} workspaceId={workspaceId} projectId={projectId} />
    </Suspense>
  );
}
