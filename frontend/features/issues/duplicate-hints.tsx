'use client';

import Link from 'next/link';
import { useSuggestions } from './use-suggestions.ts';

/**
 * "You may already have filed this."
 *
 * Shown under the issue composer while somebody types a title. Advisory in
 * the strongest sense: it never blocks the form, never preselects anything,
 * and disappears the moment the text stops matching. The worst outcome here
 * is not a missed duplicate, it is a writer who stops trusting the hint and
 * starts ignoring the panel.
 *
 * Everything degrades to showing nothing. The endpoint answers with an
 * empty list when the ML service is unconfigured or unreachable, and the
 * query below treats an error the same way, so a composer in a deployment
 * without `robis-ml` looks exactly as it did before this existed.
 */

export function DuplicateHints({ workspaceId, title }: { workspaceId: string; title: string }) {
  // Shared with the priority hint: one request for both.
  const { similar } = useSuggestions(workspaceId, title);
  if (similar.length === 0) return null;

  return (
    <aside
      // Polite, not assertive: this appears while somebody is typing, and an
      // assertive region would interrupt them mid-word.
      aria-live="polite"
      className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.07] p-3"
    >
      <p className="text-xs font-medium text-amber-200">
        {similar.length === 1 ? 'A similar issue already exists' : 'Similar issues already exist'}
      </p>

      <ul className="mt-2 space-y-1">
        {similar.map((issue) => (
          <li key={issue.id}>
            <Link
              href={`/workspaces/${workspaceId}/issues/${issue.id}`}
              className="flex items-baseline justify-between gap-3 rounded px-2 py-1 text-sm text-muted transition-colors duration-[var(--micro)] ease-[var(--ease)] hover:bg-amber-400/10 hover:text-content"
            >
              <span className="truncate">{issue.title}</span>

              {/* The score is shown rather than hidden behind a threshold,
                  so a reader can tell a near-certain duplicate from a loose
                  match instead of trusting the ranking blindly. */}
              <span className="shrink-0 font-mono text-[10px] text-faint">
                {Math.round(issue.score * 100)}% match
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}
