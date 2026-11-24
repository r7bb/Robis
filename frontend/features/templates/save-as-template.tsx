'use client';

import { contracts, type IssuePriority } from '@robis/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { call } from '../../lib/api.ts';
import { templatesKey } from './use-templates.ts';

/**
 * Save as template: keep this issue's title, description, priority and
 * labels as a starting point for the workspace, under a name, to file from
 * any board's Templates.
 */
export function SaveAsTemplate({
  workspaceId,
  issue,
}: {
  workspaceId: string;
  issue: {
    title: string;
    description: string | null;
    priority: IssuePriority;
    labelIds: readonly string[];
  };
}) {
  const queryClient = useQueryClient();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const save = useMutation({
    mutationFn: () =>
      call(contracts['issueTemplates.create'], {
        params: { workspaceId },
        body: {
          name: name.trim(),
          title: issue.title,
          description: issue.description,
          priority: issue.priority,
          labelIds: [...issue.labelIds],
        },
      }),
    onSuccess: () => {
      setNaming(false);
      return queryClient.invalidateQueries({ queryKey: templatesKey(workspaceId) });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) save.mutate();
  }

  if (!naming) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setName(issue.title.slice(0, 60));
            setNaming(true);
          }}
          className="rounded-md px-2 py-1 text-xs text-muted hover:bg-surface hover:text-content"
        >
          Save as template
        </button>
        {save.isSuccess ? (
          <span role="status" className="text-xs text-faint">
            Saved as {save.data.template.name}.
          </span>
        ) : null}
      </div>
    );
  }
  return (
    <form
      onSubmit={submit}
      aria-label="Save as template"
      className="flex flex-wrap items-center gap-2"
    >
      <input
        // biome-ignore lint/a11y/noAutofocus: naming it is the one thing to do here
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        aria-label="Template name"
        name="template-name"
        autoComplete="off"
        maxLength={60}
        className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-xs text-content outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60"
      />
      <button
        type="submit"
        disabled={!name.trim() || save.isPending}
        className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
      >
        Save
      </button>
      <button
        type="button"
        onClick={() => setNaming(false)}
        className="text-xs text-faint hover:text-content"
      >
        Cancel
      </button>
      {save.isError ? (
        <p role="alert" className="basis-full text-xs text-danger-soft">
          {(save.error as Error).message}
        </p>
      ) : null}
    </form>
  );
}
