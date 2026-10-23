'use client';

import Link from 'next/link';
import type { AssignedIssue } from './use-overview.ts';

const STATUS_LABEL: Record<AssignedIssue['status'], string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  IN_REVIEW: 'In review',
  DONE: 'Done',
  CANCELED: 'Canceled',
};

/**
 * The open issues assigned to you, across every workspace, most recently
 * touched first: the home's answer to "what should I do next".
 */
export function NeedsYou({
  issues,
  loading,
}: {
  issues: readonly AssignedIssue[];
  loading: boolean;
}) {
  return (
    <section
      aria-labelledby="home-needs-you"
      className="min-w-0 rounded-2xl border border-line bg-raised p-5 shadow-[0_12px_40px_rgb(8_9_12/0.45)]"
    >
      <h2 id="home-needs-you" className="text-sm font-semibold text-content">
        Needs you
      </h2>

      {loading ? (
        <div aria-hidden="true" className="mt-4 space-y-2">
          {[0, 1, 2].map((n) => (
            <div key={n} className="h-9 animate-pulse rounded-lg bg-surface/70" />
          ))}
        </div>
      ) : issues.length === 0 ? (
        <p className="mt-4 text-sm text-faint">
          Nothing is waiting on you. Issues assigned to you show up here.
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {issues.map((issue, index) => (
            <li
              key={issue.id}
              className="home-feed-item"
              style={{ animationDelay: `${index * 60}ms` }}
            >
              <Link
                href={`/workspaces/${issue.workspaceId}/issues/${issue.id}`}
                className="group flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-surface/60 focus-visible:bg-surface/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <span className="w-16 shrink-0 font-mono text-xs text-faint">{issue.key}</span>
                <span className="min-w-0 flex-1 truncate text-content">{issue.title}</span>
                <span className="hidden shrink-0 text-xs text-muted sm:inline">
                  {issue.workspaceName}
                </span>
                <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">
                  {STATUS_LABEL[issue.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
