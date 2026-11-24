'use client';

import { contracts, THREAD_BODY_MAX_LENGTH, THREAD_TITLE_MAX_LENGTH } from '@robis/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { ApiError, call } from '../../lib/api.ts';
import { threadHref } from '../../lib/links.ts';
import { AskedBefore } from './asked-before.tsx';
import { KINDS, spacesKey, type ThreadKind } from './spaces-model.ts';

/** Asking or sharing in a space: what kind of thread, a title, and the details. */

const FIELD =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-faint focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60';

export function ThreadComposer({
  workspaceId,
  spaceId,
  spaceName,
}: {
  workspaceId: string;
  spaceId: string;
  spaceName: string;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ThreadKind>('question');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const start = useMutation({
    mutationFn: () =>
      call(contracts['spaces.createThread'], {
        params: { workspaceId, spaceId },
        body: { kind, title: title.trim(), body: body.trim() || undefined },
      }),
    onSuccess: ({ thread }) => {
      void queryClient.invalidateQueries({ queryKey: spacesKey(workspaceId) });
      router.push(threadHref(workspaceId, thread.id));
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (title.trim()) start.mutate();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-xl border border-line bg-raised px-4 py-3 text-left text-sm text-faint shadow-sm transition-colors hover:border-accent-soft/50 hover:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
      >
        <span
          aria-hidden="true"
          className="grid h-7 w-7 place-items-center rounded-full bg-accent/15 text-accent-soft"
        >
          +
        </span>
        Ask a question or share something in {spaceName}
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      aria-label={`Start a thread in ${spaceName}`}
      className="rounded-xl border border-line bg-raised p-4 shadow-sm"
    >
      <fieldset>
        <legend className="text-xs font-medium text-muted">Kind</legend>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {(Object.keys(KINDS) as ThreadKind[]).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={kind === id}
              title={KINDS[id].hint}
              onClick={() => setKind(id)}
              className={`rounded-full px-3 py-1 text-xs ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${kind === id ? `${KINDS[id].tone} font-medium` : 'text-muted ring-line hover:text-content'}`}
            >
              {KINDS[id].label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-faint">{KINDS[kind].hint}.</p>
      </fieldset>
      <label className="mt-3 block text-xs font-medium text-muted">
        Title
        <input
          className={`${FIELD} mt-1`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={THREAD_TITLE_MAX_LENGTH}
          placeholder={kind === 'question' ? 'What do you want to know?' : 'Say it in a line'}
          required
        />
      </label>
      <AskedBefore workspaceId={workspaceId} title={title} />
      <label className="mt-3 block text-xs font-medium text-muted">
        Details
        <textarea
          className={`${FIELD} mt-1 min-h-28 resize-y`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={THREAD_BODY_MAX_LENGTH}
          placeholder="What you tried, what you saw, links: whatever helps someone answer"
        />
      </label>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="submit"
          disabled={start.isPending || !title.trim()}
          className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-contrast transition-[background-color,transform] hover:bg-accent-hover active:scale-[0.98] disabled:opacity-50"
        >
          {start.isPending ? 'Posting…' : 'Post the thread'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-muted hover:text-content"
        >
          Cancel
        </button>
      </div>
      {start.error ? (
        <p role="alert" className="mt-2 text-sm text-danger-soft">
          {start.error instanceof ApiError ? start.error.message : 'That did not work. Try again.'}
        </p>
      ) : null}
    </form>
  );
}
