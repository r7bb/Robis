'use client';

import { can } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ErrorState } from '../../../../components/ui/primitives.tsx';
import { SecurityView } from '../../../../features/security/security-view.tsx';
import { api, type WorkspaceSummary } from '../../../../lib/api.ts';
import { lastTheme, useApplyTheme } from '../../../../lib/theme.ts';

export default function SecurityPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();

  const workspace = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => api<{ workspace: WorkspaceSummary }>(`/workspaces/${workspaceId}`),
  });

  useApplyTheme(workspace.data?.workspace.theme ?? lastTheme());

  if (workspace.isError) return <ErrorState message={(workspace.error as Error).message} />;

  const role = workspace.data?.workspace.role;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-12">
      <nav className="text-sm text-faint">
        <Link href="/workspaces" className="hover:text-muted">
          Workspaces
        </Link>
        <span className="mx-2">/</span>
        <Link href={`/workspaces/${workspaceId}`} className="hover:text-muted">
          {workspace.data?.workspace.name ?? '…'}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-muted">Security</span>
      </nav>

      <header className="mt-4">
        <h1 className="text-xl font-semibold tracking-tight text-content">Security</h1>
        <p className="mt-1 max-w-[62ch] text-sm text-muted">
          Changes in this workspace, in order, with who made them. The trail is append-only and
          chained, so an edited or removed event shows when it is checked. Chat posts and document
          typing are not recorded; deletes and renames are.
        </p>
      </header>

      {role === undefined ? (
        <p className="mt-6 text-sm text-faint">Loading…</p>
      ) : can(role, 'audit:read') ? (
        <SecurityView workspaceId={workspaceId} />
      ) : (
        <p className="mt-6 rounded-lg border border-line bg-raised px-4 py-6 text-sm text-muted">
          Only admins and owners can read the full trail. The workspace's Activity tab shows recent
          changes to everyone.
        </p>
      )}
    </main>
  );
}
