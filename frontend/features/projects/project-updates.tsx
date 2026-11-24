'use client';

import {
  contracts,
  PROJECT_UPDATE_HEALTH,
  PROJECT_UPDATE_MAX_LENGTH,
  type ProjectUpdateHealth,
} from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { call } from '../../lib/api.ts';
import { formatRelative } from '../../lib/time.ts';
import { UPDATE_HEALTH_NAMES, UpdateHealth } from './update-health.tsx';

/**
 * A board's written updates: the latest in a line above the board, the
 * rest and a way to write one when opened. Members write; everyone reads.
 */
export function ProjectUpdates({
  workspaceId,
  projectId,
  canWrite,
  aside,
}: {
  workspaceId: string;
  projectId: string;
  canWrite: boolean;
  /** More of the board's own controls, on the same line (Repeats). */
  aside?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const updates = useQuery({
    queryKey: ['project-updates', workspaceId, projectId],
    queryFn: () => call(contracts['projectUpdates.list'], { params: { workspaceId, projectId } }),
  });
  const list = updates.data?.updates ?? [];
  const latest = list[0];
  if (!latest && !canWrite && !aside) return null;

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 text-xs">
        {latest ? (
          <>
            <UpdateHealth health={latest.health} />
            <span className="min-w-0 flex-1 truncate text-muted">
              {latest.body}
              <span className="text-faint">
                {' '}
                · {latest.authorName}, {formatRelative(latest.createdAt)}
              </span>
            </span>
          </>
        ) : (
          <span className="flex-1 text-faint">No update yet on how this board is going.</span>
        )}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
          className="shrink-0 rounded px-1.5 py-0.5 text-muted transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-soft"
        >
          {open ? 'Close' : canWrite ? 'Updates' : 'All updates'}
        </button>
        {aside}
      </div>
      {open ? (
        <section
          aria-label="Project updates"
          className="mt-2 space-y-3 rounded-lg border border-line bg-raised p-3"
        >
          {canWrite ? <WriteUpdate workspaceId={workspaceId} projectId={projectId} /> : null}
          <ul className="divide-y divide-line">
            {list.map((update) => (
              <li key={update.id} className="py-2">
                <div className="flex items-center gap-2 text-[11px] text-faint">
                  <UpdateHealth health={update.health} />
                  {update.authorName}, {formatRelative(update.createdAt)}
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-content">
                  {update.body}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function WriteUpdate({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const queryClient = useQueryClient();
  const [health, setHealth] = useState<ProjectUpdateHealth>('on_track');
  const [body, setBody] = useState('');
  const write = useMutation({
    mutationFn: () =>
      call(contracts['projectUpdates.create'], {
        params: { workspaceId, projectId },
        body: { health, body: body.trim() },
      }),
    onSuccess: () => {
      setBody('');
      void queryClient.invalidateQueries({ queryKey: ['project-updates-latest', workspaceId] });
      return queryClient.invalidateQueries({
        queryKey: ['project-updates', workspaceId, projectId],
      });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (body.trim()) write.mutate();
  }

  return (
    <form onSubmit={submit} aria-label="Write an update" className="space-y-2">
      <fieldset className="flex flex-wrap gap-1.5">
        <legend className="sr-only">How it is going</legend>
        {PROJECT_UPDATE_HEALTH.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={health === value}
            onClick={() => setHealth(value)}
            className={`rounded-full px-2.5 py-0.5 text-xs ring-1 transition-colors ${
              health === value
                ? 'bg-accent/15 font-medium text-content ring-accent/50'
                : 'text-muted ring-line hover:text-content'
            }`}
          >
            {UPDATE_HEALTH_NAMES[value]}
          </button>
        ))}
      </fieldset>
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={PROJECT_UPDATE_MAX_LENGTH}
        aria-label="How it is going"
        placeholder="What moved, what is in the way, what comes next"
        className="min-h-20 w-full resize-y rounded-md border border-line bg-surface px-2.5 py-2 text-sm text-content outline-none placeholder:text-faint focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60"
      />
      <div className="flex items-center justify-end gap-2">
        {write.isError ? (
          <p role="alert" className="mr-auto text-xs text-danger-soft">
            {(write.error as Error).message}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={!body.trim() || write.isPending}
          className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
        >
          Post update
        </button>
      </div>
    </form>
  );
}
