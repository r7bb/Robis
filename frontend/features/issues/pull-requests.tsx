'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';

/**
 * The GitHub pull requests that name this issue's key (C7), with each
 * one's state as GitHub last reported it. Nothing is shown when there are
 * none, so a workspace not connected to GitHub sees no empty box.
 */

const STATE_TONE = {
  open: 'text-emerald-300',
  draft: 'text-muted',
  merged: 'text-violet-300',
  closed: 'text-danger-soft',
} as const;

export function PullRequests({ workspaceId, issueId }: { workspaceId: string; issueId: string }) {
  const list = useQuery({
    queryKey: ['pull-requests', issueId],
    queryFn: () => call(contracts['issues.pullRequests'], { params: { workspaceId, issueId } }),
  });
  // https only, checked here too: a link from outside is clicked inside.
  const rows = (list.data?.pullRequests ?? []).filter((pr) => pr.url.startsWith('https://'));
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="pull-requests-heading" className="mt-8">
      <h2
        id="pull-requests-heading"
        className="text-[11px] font-semibold uppercase tracking-wider text-faint"
      >
        Pull requests
      </h2>
      <ul className="mt-2 space-y-1.5">
        {rows.map((pr) => (
          <li key={`${pr.repo}#${pr.number}`} className="flex items-baseline gap-2 text-sm">
            <span className={`text-xs font-medium ${STATE_TONE[pr.state]}`}>{pr.state}</span>
            <a
              href={pr.url}
              target="_blank"
              rel="noreferrer noopener"
              className="min-w-0 truncate text-content underline-offset-2 hover:underline"
            >
              {pr.title}
            </a>
            <span className="shrink-0 font-mono text-xs text-faint">
              {pr.repo}#{pr.number}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
