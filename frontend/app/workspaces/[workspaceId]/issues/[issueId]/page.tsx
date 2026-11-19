'use client';

import { contracts } from '@robis/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { PresenceBar } from '../../../../../components/presence.tsx';
import { IssueDetail } from '../../../../../features/issues/issue-detail.tsx';
import { call } from '../../../../../lib/api.ts';
import { useCoalesced, useRealtime } from '../../../../../lib/realtime.ts';
import { concernsIssue } from '../../../../../lib/realtime-events.ts';
import { lastTheme, useApplyTheme } from '../../../../../lib/theme.ts';

/**
 * One issue as a page of its own, with a way back to its workspace and
 * board. The same issue opens over the board as a peek (see `IssuePeek`).
 */
export default function IssuePage() {
  const { workspaceId, issueId } = useParams<{ workspaceId: string; issueId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  // Refresh when something happens to this issue (an edit, a comment, an
  // image), so a field someone else changed does not sit stale on screen;
  // other events in the workspace leave it alone, and a burst is one refresh.
  const refreshIssue = useCoalesced(() => {
    queryClient.invalidateQueries({ queryKey: ['issue', workspaceId, issueId] });
    queryClient.invalidateQueries({ queryKey: ['comments', workspaceId, issueId] });
  });
  const { presence, state: realtimeState } = useRealtime(
    workspaceId,
    issueId,
    (event) => {
      if (concernsIssue(event, issueId)) refreshIssue();
    },
    // Only this issue's events reach the socket at all (stage 3, item 24).
    { scopes: [{ kind: 'issue', issueId }] },
  );

  const workspace = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => call(contracts['workspaces.get'], { params: { workspaceId } }),
  });
  useApplyTheme(workspace.data?.workspace.theme ?? lastTheme());
  const issue = useQuery({
    queryKey: ['issue', workspaceId, issueId],
    queryFn: () => call(contracts['issues.get'], { params: { workspaceId, issueId } }),
  });
  const data = issue.data?.issue;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <nav className="text-sm text-faint">
        <Link href="/workspaces" className="hover:text-muted">
          Workspaces
        </Link>
        <span className="mx-2">/</span>
        <Link href={`/workspaces/${workspaceId}`} className="hover:text-muted">
          {workspace.data?.workspace.name ?? '…'}
        </Link>
        {data && (
          <>
            <span className="mx-2">/</span>
            <Link
              href={`/workspaces/${workspaceId}/projects/${data.projectId}`}
              className="hover:text-muted"
            >
              Board
            </Link>
          </>
        )}
        <span className="mx-2">/</span>
        <span className="font-mono text-muted">{data?.key ?? '…'}</span>
      </nav>

      <div className="mt-4">
        <IssueDetail
          workspaceId={workspaceId}
          issueId={issueId}
          toolbar={<PresenceBar users={presence} state={realtimeState} here={issueId} />}
          onDeleted={(projectId) =>
            router.replace(
              projectId
                ? `/workspaces/${workspaceId}/projects/${projectId}`
                : `/workspaces/${workspaceId}`,
            )
          }
        />
      </div>
    </main>
  );
}
