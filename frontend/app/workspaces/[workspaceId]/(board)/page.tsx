'use client';

import { can, contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { EmptyView } from '../../../../components/empty-view.tsx';
import { ProjectsPanel } from '../../../../features/workspace/panels.tsx';
import { call } from '../../../../lib/api.ts';
import { boardToOpen, lastBoard } from '../../../../lib/last-board.ts';
import { boardHref } from '../../../../lib/links.ts';

/**
 * Coming into a workspace opens a board: the one last open here, or the
 * first. The address keeps anything it was given (a room to open), for the
 * frame to read. With no projects yet, the middle says what a board is and
 * offers to make the first (C5).
 */
export default function WorkspacePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const router = useRouter();

  const projects = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => call(contracts['projects.list'], { params: { workspaceId } }),
  });
  const workspace = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => call(contracts['workspaces.get'], { params: { workspaceId } }),
  });
  const target = projects.data ? boardToOpen(projects.data.projects, lastBoard(workspaceId)) : null;

  useEffect(() => {
    if (!target) return;
    router.replace(`${boardHref(workspaceId, target)}${window.location.search}`, { scroll: false });
  }, [target, workspaceId, router]);

  const role = workspace.data?.workspace.role;
  if (projects.isError) {
    return (
      <p role="alert" className="px-6 py-16 text-center text-sm text-muted">
        The boards could not be loaded. Check your connection and reload the page.
      </p>
    );
  }
  if (!projects.isSuccess || target || !role) return null;

  return (
    <div className="mx-auto max-w-md space-y-4 px-6 py-16">
      <h1 className="sr-only">No boards yet</h1>
      <EmptyView view="boards" workspaceId={workspaceId} canFill={can(role, 'project:create')} />
      <ProjectsPanel workspaceId={workspaceId} role={role} />
    </div>
  );
}
