'use client';

import { can, type Role } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { DeleteButton } from '../../components/delete-button.tsx';
import { Button, EmptyState, InlineError } from '../../components/ui/primitives.tsx';
import { api, type DocumentSummary, type ProjectSummary } from '../../lib/api.ts';
import { formatRelative } from '../../lib/time.ts';

/**
 * Projects and documents, as right-rail panels.
 *
 * These were two inline sections of the workspace page. Moving them here was
 * not tidying for its own sake: the page became a shell that can show any
 * panel beside the conversation, and a section that only exists as part of a
 * 250-line page cannot be shown beside anything.
 *
 * They share a file because they are the same shape -- a create form over a
 * list of links with a delete control -- and splitting them would mean
 * maintaining that shape in two places.
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
    queryFn: () => api<{ projects: ProjectSummary[] }>(`/workspaces/${workspaceId}/projects`),
  });

  const create = useMutation({
    mutationFn: (name: string) =>
      api<{ project: ProjectSummary }>(`/workspaces/${workspaceId}/projects`, {
        method: 'POST',
        body: { name },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', workspaceId] }),
  });

  const remove = useMutation({
    mutationFn: (projectId: string) =>
      api<void>(`/workspaces/${workspaceId}/projects/${projectId}`, { method: 'DELETE' }),
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

export function DocumentsPanel({ workspaceId, role }: { workspaceId: string; role: Role }) {
  const queryClient = useQueryClient();

  const documents = useQuery({
    queryKey: ['documents', workspaceId],
    queryFn: () => api<{ documents: DocumentSummary[] }>(`/workspaces/${workspaceId}/documents`),
  });

  const create = useMutation({
    mutationFn: (title: string) =>
      api<{ document: DocumentSummary }>(`/workspaces/${workspaceId}/documents`, {
        method: 'POST',
        body: { title },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents', workspaceId] }),
  });

  const remove = useMutation({
    mutationFn: (documentId: string) =>
      api<void>(`/workspaces/${workspaceId}/documents/${documentId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents', workspaceId] }),
  });

  const rows = documents.data?.documents ?? [];

  return (
    <div className="space-y-3">
      {/* Documents are governed by the project permission rather than one of
          their own, which is what the API checks too. */}
      {can(role, 'project:create') ? (
        <CreateForm
          placeholder="New document"
          label="New document title"
          pending={create.isPending}
          onSubmit={(title) => create.mutate(title)}
        />
      ) : null}

      {documents.isError ? <InlineError>Could not load documents.</InlineError> : null}

      {documents.isSuccess && rows.length === 0 ? (
        <EmptyState>No documents yet. Create one to try collaborative editing.</EmptyState>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((document) => (
            <li
              key={document.id}
              className="flex items-center rounded-lg border border-line bg-surface transition-colors hover:border-faint"
            >
              <Link
                href={`/workspaces/${workspaceId}/documents/${document.id}`}
                className="min-w-0 flex-1 px-3 py-2"
              >
                <span className="block truncate text-sm text-content">{document.title}</span>
                <span className="mt-0.5 block text-[11px] text-faint">
                  edited {formatRelative(document.updatedAt)}
                </span>
              </Link>

              <DeleteButton
                allowed={can(role, 'project:delete')}
                kind="document"
                name={document.title}
                cascade="The document and its entire edit history are removed."
                onConfirm={() => remove.mutateAsync(document.id)}
                className="mr-1.5"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
