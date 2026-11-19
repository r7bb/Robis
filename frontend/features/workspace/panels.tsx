'use client';

import { can, contracts, type Role } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { DeleteButton } from '../../components/delete-button.tsx';
import { Button, EmptyState, InlineError } from '../../components/ui/primitives.tsx';
import { call } from '../../lib/api.ts';

/**
 * The projects list with its create form and delete controls, shown in the
 * middle of a workspace that has no board yet. The left rail lists the
 * boards once there are some; deleting one stays here, out of the way.
 */

const INPUT =
  'min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-content placeholder:text-faint focus:border-accent-soft focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-soft';

/** The create-one-thing form both panels put above their list. */
function CreateForm({
  placeholder,
  label,
  pending,
  onSubmit,
}: {
  placeholder: string;
  label: string;
  pending: boolean;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();

    const trimmed = value.trim();
    if (!trimmed || pending) return;

    onSubmit(trimmed);
    setValue('');
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className={INPUT}
      />

      <Button type="submit" variant="primary" size="sm" disabled={pending || !value.trim()}>
        Add
      </Button>
    </form>
  );
}

export function ProjectsPanel({ workspaceId, role }: { workspaceId: string; role: Role }) {
  const queryClient = useQueryClient();

  const projects = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => call(contracts['projects.list'], { params: { workspaceId } }),
  });

  const create = useMutation({
    mutationFn: (name: string) =>
      call(contracts['projects.create'], { params: { workspaceId }, body: { name } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', workspaceId] }),
  });

  const remove = useMutation({
    mutationFn: (projectId: string) =>
      call(contracts['projects.delete'], { params: { workspaceId, projectId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', workspaceId] }),
  });

  const rows = projects.data?.projects ?? [];

  return (
    <div className="space-y-3">
      {can(role, 'project:create') ? (
        <CreateForm
          placeholder="New project"
          label="New project name"
          pending={create.isPending}
          onSubmit={(name) => create.mutate(name)}
        />
      ) : null}

      {projects.isError ? <InlineError>Could not load projects.</InlineError> : null}

      {projects.isSuccess && rows.length === 0 ? (
        <EmptyState>No projects yet.</EmptyState>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((project) => (
            <li
              key={project.id}
              className="group flex items-center rounded-lg border border-line bg-surface transition-colors hover:border-faint"
            >
              {/* The delete control is a sibling of the link, not a child:
                  a button inside an anchor is invalid HTML, and intercepting
                  the click to work around it is worse than laying it out
                  correctly. A flex row rather than an absolute corner, so it
                  sits centred beside the text instead of under the key. */}
              <Link
                href={`/workspaces/${workspaceId}/projects/${project.id}`}
                className="block min-w-0 flex-1 px-3 py-2"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium text-content">{project.name}</span>
                  <span className="shrink-0 font-mono text-[10px] text-faint">{project.key}</span>
                </span>

                <span className="mt-0.5 block text-[11px] text-faint">
                  {project.openIssues} open {project.openIssues === 1 ? 'issue' : 'issues'}
                </span>
              </Link>

              <DeleteButton
                allowed={can(role, 'project:delete')}
                kind="project"
                name={project.name}
                cascade="Every issue and comment in this project is deleted with it."
                onConfirm={() => remove.mutateAsync(project.id)}
                className="mr-1.5 shrink-0"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
