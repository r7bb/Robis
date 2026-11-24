'use client';

import { contracts, type IssuePriority } from '@robis/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { call } from '../../lib/api.ts';
import { issueHref } from '../../lib/links.ts';
import { Generated } from './generated.tsx';
import { useAssist, waitForAnswer } from './use-assist.ts';

/**
 * Make an issue from a chat message (D3): the provider suggests a title and
 * a priority, the person checks them and picks the board, and only Create
 * makes the issue. Shown on hover beside the message, where assistance is on.
 */
export function IssueFromMessage({
  workspaceId,
  messageId,
}: {
  workspaceId: string;
  messageId: string;
}) {
  const { available } = useAssist(workspaceId);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<IssuePriority>('NONE');
  const [projectId, setProjectId] = useState('');
  const projects = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => call(contracts['projects.list'], { params: { workspaceId } }),
    enabled: open,
  });
  const ask = useMutation({
    mutationFn: async () => {
      const { request } = await call(contracts['assist.issue'], {
        params: { workspaceId },
        body: { messageId },
      });
      return waitForAnswer(workspaceId, request.id, 'issue');
    },
    onSuccess: (draft) => {
      setTitle(draft.title);
      setPriority(draft.priority);
    },
  });
  const create = useMutation({
    mutationFn: () =>
      call(contracts['issues.create'], {
        params: { workspaceId, projectId: projectId || boards[0]!.id },
        body: { title: title.trim(), priority },
      }),
  });
  if (!available) return null;
  const boards = (projects.data?.projects ?? []).filter((p) => !p.archived);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (title.trim() && boards.length > 0) create.mutate();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          ask.mutate();
        }}
        className="self-start rounded px-1.5 py-0.5 text-[10px] text-faint opacity-0 transition-opacity hover:text-content focus-visible:opacity-100 group-hover:opacity-100"
      >
        Make an issue
      </button>
    );
  }

  return (
    <div className="basis-full">
      <Generated title="New issue from this message" onClose={() => setOpen(false)}>
        {create.data ? (
          <p>
            Made{' '}
            <Link
              href={issueHref(workspaceId, create.data.issue.id)}
              className="text-accent-soft hover:underline"
            >
              {create.data.issue.title}
            </Link>
            .
          </p>
        ) : ask.isPending ? (
          <p className="text-muted">Drafting…</p>
        ) : (
          <form onSubmit={submit} className="space-y-2" aria-label="New issue from this message">
            {ask.error ? (
              <p role="alert" className="text-xs text-danger-soft">
                {ask.error instanceof Error ? ask.error.message : 'No suggestion; write your own.'}
              </p>
            ) : null}
            <input
              aria-label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-content"
            />
            <div className="flex flex-wrap gap-2">
              <select
                aria-label="Board"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-content"
              >
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as IssuePriority)}
                className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-content"
              >
                {['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => (
                  <option key={p} value={p}>
                    {p.charAt(0) + p.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={create.isPending || !title.trim() || boards.length === 0}
                className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </form>
        )}
      </Generated>
    </div>
  );
}
