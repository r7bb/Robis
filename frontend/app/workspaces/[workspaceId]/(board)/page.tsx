'use client';

import { can, contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ProjectsPanel } from '../../../../features/workspace/panels.tsx';
import { call } from '../../../../lib/api.ts';
import { boardToOpen, lastBoard } from '../../../../lib/last-board.ts';
import { boardHref } from '../../../../lib/links.ts';

/**
 * Coming into a workspace opens a board: the one last open here, or the
 * first. The address keeps anything it was given (a room to open), for the
 * frame to read. With no projects yet, the middle says so and offers to make
 * the first.
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
    <div className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-lg font-semibold tracking-tight text-content">No boards yet</h1>
      <p className="mt-1 text-sm text-muted">
        {can(role, 'project:create')
          ? 'Each project has a board of its issues. Name the first one to start.'
          : 'Each project has a board of its issues. An admin can make the first one.'}
      </p>
      <div className="mt-6">
        <ProjectsPanel workspaceId={workspaceId} role={role} />
      </div>
    </div>
  );
}
