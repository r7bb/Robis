'use client';

import type { CSSProperties } from 'react';
import type { WorkspaceSummary } from '../../lib/api.ts';
import type { WorkspaceOverview } from './use-overview.ts';
import { type TileSignals, WorkspaceTile } from './workspace-tile.tsx';

/**
 * Your workspaces as tiles: shaped placeholders while the list loads, a
 * line on how to start when there are none, and otherwise one tile each,
 * the first `liveCount` kept live.
 */
export function WorkspaceGrid({
  loading,
  workspaces,
  overviewById,
  myId,
  liveCount,
  signals,
  onDelete,
}: {
  loading: boolean;
  workspaces: readonly WorkspaceSummary[];
  overviewById: ReadonlyMap<string, WorkspaceOverview>;
  myId: string;
  liveCount: number;
  signals: TileSignals;
  onDelete: (workspaceId: string, password: string) => Promise<void>;
}) {
  if (loading) {
    return (
      <div aria-hidden="true" className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((n) => (
          <div key={n} className="h-60 animate-pulse rounded-2xl border border-line bg-raised/50" />
        ))}
      </div>
    );
  }

  if (workspaces.length === 0) {
    return (
      <div className="mt-5 rounded-2xl border border-dashed border-line px-6 py-14 text-center">
        <p className="text-content">No workspaces yet.</p>
        <p className="mt-1 text-sm text-muted">
          Make one for your team, or accept an invitation above.
        </p>
      </div>
    );
  }

  return (
    <ul
      className={`home-tiles mt-5 grid gap-4 sm:grid-cols-2 ${workspaces.length >= 3 ? 'xl:grid-cols-3' : ''}`}
    >
      {workspaces.map((workspace, index) => (
        <WorkspaceTile
          key={workspace.id}
          workspace={workspace}
          overview={overviewById.get(workspace.id)}
          myId={myId}
          live={index < liveCount}
          signals={signals}
          style={{ '--i': index } as CSSProperties}
          onDelete={(password) => onDelete(workspace.id, password)}
        />
      ))}
    </ul>
  );
}
