'use client';

import { contracts, type IssueStatus } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { StatusBadge } from '../../components/ui/badges.tsx';
import { call } from '../../lib/api.ts';

/**
 * An issue's place in its project's tree (C1): the issue it is part of,
 * chosen from the same project, and the sub-issues that are part of it.
 * The server refuses a parent that would make a loop; this only offers
 * the obvious choices.
 */

type Relative = { id: string; key: string; title: string; status: IssueStatus };

const FIELD_CLASS =
  'w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-content outline-none transition focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-60';

/** How many of the project's issues the parent list offers. */
const PARENT_CHOICES = 100;

export function ParentPicker({
  workspaceId,
  projectId,
  issueId,
  parent,
  subIssues,
  canEdit,
  onChange,
}: {
  workspaceId: string;
  projectId: string;
  issueId: string;
  parent: Relative | null;
  subIssues: readonly Relative[];
  canEdit: boolean;
  onChange: (parentId: string | null) => void;
}) {
  const candidates = useQuery({
    queryKey: ['issues', workspaceId, projectId, 'parents'],
    queryFn: () =>
      call(contracts['issues.list'], {
        params: { workspaceId, projectId },
        query: { limit: PARENT_CHOICES },
      }),
    enabled: canEdit,
  });
  // Itself and its own sub-issues are never a parent; deeper loops the
  // server refuses with a reason.
  const ruledOut = new Set([issueId, ...subIssues.map((c) => c.id)]);
  const listed = (candidates.data?.issues ?? []).filter((i) => !ruledOut.has(i.id));
  // The current parent is always a choice, even past the first page, so the
  // field never claims there is none.
  const options = parent && !listed.some((i) => i.id === parent.id) ? [parent, ...listed] : listed;

  return (
    <select
      value={parent?.id ?? ''}
      disabled={!canEdit}
      onChange={(event) => onChange(event.target.value || null)}
      aria-label="Part of"
      className={FIELD_CLASS}
    >
      <option value="">Not part of another issue</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.key} · {option.title}
        </option>
      ))}
    </select>
  );
}

export function SubIssues({
  workspaceId,
  projectId,
  issueId,
  parent,
  items,
  canEdit,
}: {
  workspaceId: string;
  projectId: string;
  issueId: string;
  parent: Relative | null;
  items: readonly Relative[];
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const add = useMutation({
    mutationFn: () =>
      call(contracts['issues.create'], {
        params: { workspaceId, projectId },
        body: { title: title.trim(), parentId: issueId },
      }),
    onSuccess: () => {
      setTitle('');
      queryClient.invalidateQueries({ queryKey: ['issue', workspaceId, issueId] });
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (title.trim()) add.mutate();
  }

  if (!canEdit && items.length === 0 && !parent) return null;
  const done = items.filter((i) => i.status === 'DONE' || i.status === 'CANCELED').length;

  return (
    <section className="mt-8" aria-labelledby="sub-issues-heading">
      <h2
        id="sub-issues-heading"
        className="text-xs font-medium uppercase tracking-wide text-faint"
      >
        Sub-issues
        {items.length > 0 && (
          <span className="ml-2 normal-case tracking-normal tabular-nums">
            {done} of {items.length} done
          </span>
        )}
      </h2>
      {parent && (
        <p className="mt-2 text-sm text-muted">
          Part of{' '}
          <Link
            href={`/workspaces/${workspaceId}/issues/${parent.id}`}
            className="text-content hover:underline"
          >
            <span className="font-mono text-xs text-faint">{parent.key}</span> {parent.title}
          </Link>
        </p>
      )}
      {items.length > 0 && (
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-raised">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/workspaces/${workspaceId}/issues/${item.id}`}
                className="flex items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-surface"
              >
                <span className="shrink-0 font-mono text-[10px] text-faint">{item.key}</span>
                <span className="min-w-0 flex-1 truncate text-content">{item.title}</span>
                <StatusBadge status={item.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form onSubmit={onSubmit} className="mt-2 flex gap-2">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            name="sub-issue-title"
            autoComplete="off"
            maxLength={200}
            placeholder="Add a sub-issue…"
            aria-label="New sub-issue title"
            className={`${FIELD_CLASS} min-w-0 flex-1`}
          />
          <button
            type="submit"
            disabled={add.isPending || !title.trim()}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
          >
            {add.isPending ? 'Adding…' : 'Add'}
          </button>
        </form>
      )}
      {add.error && (
        <p role="alert" className="mt-2 text-sm text-danger-soft">
          {(add.error as Error).message}
        </p>
      )}
    </section>
  );
}
