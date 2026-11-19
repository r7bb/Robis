'use client';

import { type ReactNode, Suspense } from 'react';
import { WorkspaceFrame } from '../../../../features/workspace/workspace-frame.tsx';

/**
 * The workspace and its boards share one frame (see `WorkspaceFrame`), so
 * going from one board to another keeps the chat and its connection open.
 * The frame reads the room to open from the address, which needs a boundary.
 */
export default function BoardLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="h-dvh bg-surface" />}>
      <WorkspaceFrame>{children}</WorkspaceFrame>
    </Suspense>
  );
}
