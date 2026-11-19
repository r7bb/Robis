'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { call } from '../../lib/api.ts';

/** The workspace and the caller's role there, for a page in the middle. */
export function useWorkspaceRole() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const workspace = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => call(contracts['workspaces.get'], { params: { workspaceId } }),
  });
  return { workspaceId, role: workspace.data?.workspace.role };
}

/** A page in the middle of the workspace: a title, a line on what it is, and the page. */
export function PageFrame({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <h1 className="text-balance text-lg font-semibold tracking-tight text-content">{title}</h1>
      <p className="mt-1 max-w-[65ch] text-sm text-muted">{lead}</p>
      <div className="mt-6">{children}</div>
    </div>
  );
}
