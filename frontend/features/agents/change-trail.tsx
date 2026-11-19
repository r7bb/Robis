'use client';

import { contracts, type ResponseOf } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { describeAgentChange } from '../../lib/agent-change-text.ts';
import { ApiError, call } from '../../lib/api.ts';
import { formatRelative } from '../../lib/time.ts';

type Change = ResponseOf<(typeof contracts)['agents.changes']>['changes'][number];

/** What each state says where Undo would be. */
const STATE_WORDS: Record<Exclude<Change['state'], 'undoable'>, string> = {
  undone: 'Undone',
  changed: 'Changed since',
  gone: 'Deleted',
  manual: 'Remove from its page',
};

/**
 * The agents' changes, newest first (idea 6): each in a sentence, linked to
 * its issue, with Undo while it is as the agent left it. Undo goes through
 * the same paths a person's edit does and is in the audit trail under you.
 */
export function ChangeTrail({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const changes = useQuery({
    queryKey: ['agent-changes', workspaceId],
    queryFn: () => call(contracts['agents.changes'], { params: { workspaceId } }),
  });
  const undo = useMutation({
    mutationFn: (changeId: string) =>
      call(contracts['agents.undoChange'], { params: { workspaceId, changeId } }),
    onMutate: () => setError(null),
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : 'That could not be undone.'),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-changes', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['agents-activity', workspaceId] });
    },
  });
  const rows = changes.data?.changes ?? [];

  return (
    <section aria-labelledby="trail-heading">
      <h2 id="trail-heading" className="text-sm font-medium uppercase tracking-wide text-faint">
        What they changed
      </h2>
      <p className="mt-1 text-sm text-muted">
        The latest changes agents made, newest first. Undo puts one back while nobody has changed it
        since.
      </p>
      <div aria-live="polite" className="mt-2 min-h-5">
        {error ? <p className="text-sm text-danger-soft">{error}</p> : null}
      </div>

      {changes.isError ? (
        <p className="mt-2 text-sm text-faint">The changes could not be loaded.</p>
      ) : changes.isSuccess && rows.length === 0 ? (
        <p className="mt-2 text-sm text-faint">No agent has changed anything yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-raised">
          {rows.map((change) => (
            <li key={change.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                {change.issueId ? (
                  <Link
                    href={`/workspaces/${workspaceId}/issues/${change.issueId}`}
                    className="text-content hover:underline"
                  >
                    {describeAgentChange(change)}
                  </Link>
                ) : (
                  <span className="text-muted">{describeAgentChange(change)}</span>
                )}
                <span className="ml-2 text-xs text-faint">
                  {formatRelative(new Date(change.at))}
                </span>
              </span>
              {change.state === 'undoable' ? (
                <button
                  type="button"
                  onClick={() => undo.mutate(change.id)}
                  disabled={undo.isPending}
                  className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:bg-surface hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-50"
                >
                  Undo
                </button>
              ) : (
                <span className="shrink-0 text-xs text-faint">{STATE_WORDS[change.state]}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
