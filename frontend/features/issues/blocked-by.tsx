'use client';

import { contracts, type ResponseOf } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { call } from '../../lib/api.ts';
import { issueHref } from '../../lib/links.ts';

type Blocks = ResponseOf<(typeof contracts)['issues.blocks']>;
type Related = Blocks['blockedBy'][number];

const FINISHED = new Set(['DONE', 'CANCELED']);

/**
 * Blocked by, on an issue: what it waits on (added by key, like REL-12) and
 * what waits on it. A blocker done or canceled is struck through: it no
 * longer holds anything up. A loop, or the issue itself, is refused with
 * the reason.
 */
export function BlockedBy({
  workspaceId,
  issueId,
  canEdit,
}: {
  workspaceId: string;
  issueId: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const key = ['issue-blocks', workspaceId, issueId];
  const blocks = useQuery({
    queryKey: key,
    queryFn: () => call(contracts['issues.blocks'], { params: { workspaceId, issueId } }),
  });
  const [typed, setTyped] = useState('');
  const settle = (next: Blocks) => {
    queryClient.setQueryData(key, next);
    void queryClient.invalidateQueries({ queryKey: ['project-blocked', workspaceId] });
  };
  const add = useMutation({
    mutationFn: async (issueKey: string) => {
      const found = await call(contracts['issues.byKey'], {
        params: { workspaceId, key: issueKey },
      }).catch(() => {
        throw new Error(`No issue ${issueKey.toUpperCase()} here.`);
      });
      return call(contracts['issues.addBlocker'], {
        params: { workspaceId, issueId },
        body: { blockerId: found.issue.id },
      });
    },
    onSuccess: (next) => {
      setTyped('');
      settle(next);
    },
  });
  const remove = useMutation({
    mutationFn: (blockerId: string) =>
      call(contracts['issues.removeBlocker'], { params: { workspaceId, issueId, blockerId } }),
    onSuccess: settle,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (typed.trim()) add.mutate(typed.trim());
  }

  const waitingOn = blocks.data?.blockedBy ?? [];
  const holdingUp = blocks.data?.blocking ?? [];
  return (
    <div className="space-y-1.5">
      {waitingOn.length > 0 ? (
        <ul className="space-y-1">
          {waitingOn.map((issue) => (
            <RelatedRow
              key={issue.id}
              workspaceId={workspaceId}
              issue={issue}
              onRemove={canEdit ? () => remove.mutate(issue.id) : undefined}
            />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-faint">Not waiting on anything.</p>
      )}
      {canEdit ? (
        <form onSubmit={submit} className="flex gap-1.5">
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Waits on, by key: REL-12"
            aria-label="Add an issue this waits on, by key"
            maxLength={24}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-xs text-content outline-none placeholder:text-faint focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60"
          />
          <button
            type="submit"
            disabled={!typed.trim() || add.isPending}
            className="rounded-md px-2 py-1 text-xs text-muted hover:bg-surface hover:text-content disabled:opacity-50"
          >
            Add
          </button>
        </form>
      ) : null}
      {add.isError ? (
        <p role="alert" className="text-xs text-danger-soft">
          {(add.error as Error).message}
        </p>
      ) : null}
      {holdingUp.length > 0 ? (
        <p className="text-xs text-faint">
          Holding up{' '}
          {holdingUp.map((issue, index) => (
            <span key={issue.id}>
              {index > 0 ? ', ' : ''}
              <Link
                href={issueHref(workspaceId, issue.id)}
                className="font-mono text-accent-soft hover:underline"
              >
                {issue.key}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

function RelatedRow({
  workspaceId,
  issue,
  onRemove,
}: {
  workspaceId: string;
  issue: Related;
  onRemove?: () => void;
}) {
  const finished = FINISHED.has(issue.status);
  return (
    <li className="flex items-baseline gap-2 text-sm">
      <Link
        href={issueHref(workspaceId, issue.id)}
        className={`min-w-0 flex-1 truncate hover:underline ${finished ? 'text-faint line-through' : 'text-content'}`}
      >
        <span className="mr-1.5 font-mono text-xs text-faint">{issue.key}</span>
        {issue.title}
      </Link>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`No longer waits on ${issue.key}`}
          className="shrink-0 rounded px-1 text-xs text-faint hover:text-danger-soft"
        >
          Remove
        </button>
      ) : null}
    </li>
  );
}
