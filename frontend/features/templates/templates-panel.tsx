'use client';

import { can, contracts, type Role } from '@robis/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { call } from '../../lib/api.ts';
import { useDropdown } from '../../lib/use-dropdown.ts';
import { useMyId } from '../../lib/use-people.ts';
import { type IssueTemplate, startingTitle, templatesKey, useTemplates } from './use-templates.ts';

const FIELD =
  'w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-content outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60';

/**
 * Templates on a board: pick one, finish its title, and file it here with
 * its description, priority and labels. Whoever made one, or an admin,
 * removes it; new ones come from Save as template on an issue.
 */
export function TemplatesPanel({
  workspaceId,
  projectId,
  role,
}: {
  workspaceId: string;
  projectId: string;
  role: Role | undefined;
}) {
  const allowed = Boolean(role) && can(role!, 'issue:create');
  const { open, setOpen, box } = useDropdown();
  const templates = useTemplates(workspaceId, allowed);
  const [chosen, setChosen] = useState<IssueTemplate | null>(null);
  const list = templates.data?.templates ?? [];
  if (!allowed) return null;

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((was) => !was);
          setChosen(null);
        }}
        className="rounded px-1.5 py-0.5 text-xs text-muted transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-soft"
      >
        Templates{list.length > 0 ? ` · ${list.length}` : ''}
      </button>
      {open ? (
        <section
          aria-label="Templates"
          className="absolute right-0 top-full z-20 mt-1 w-[min(28rem,calc(100vw-2rem))] space-y-3 rounded-lg border border-line bg-raised p-3 shadow-xl"
        >
          {chosen ? (
            <FileFromTemplate
              workspaceId={workspaceId}
              projectId={projectId}
              template={chosen}
              onBack={() => setChosen(null)}
              onDone={() => {
                setChosen(null);
                setOpen(false);
              }}
            />
          ) : (
            <TemplateList workspaceId={workspaceId} role={role} list={list} onChoose={setChosen} />
          )}
        </section>
      ) : null}
    </div>
  );
}

function TemplateList({
  workspaceId,
  role,
  list,
  onChoose,
}: {
  workspaceId: string;
  role: Role | undefined;
  list: readonly IssueTemplate[];
  onChoose: (template: IssueTemplate) => void;
}) {
  const me = useMyId();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (templateId: string) =>
      call(contracts['issueTemplates.remove'], { params: { workspaceId, templateId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: templatesKey(workspaceId) }),
  });
  const admin = Boolean(role) && can(role!, 'project:delete');
  if (list.length === 0) {
    return (
      <p className="text-xs text-faint">
        No templates yet. Open an issue that is a good starting point and choose Save as template.
      </p>
    );
  }
  return (
    <>
      <p className="text-xs text-faint">
        File an issue here from one of the workspace’s templates.
      </p>
      <ul className="divide-y divide-line">
        {list.map((template) => (
          <li key={template.id} className="flex items-center gap-2 py-1.5">
            <button
              type="button"
              onClick={() => onChoose(template)}
              className="min-w-0 flex-1 rounded text-left hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-soft"
            >
              <span className="block truncate text-sm text-content">{template.name}</span>
              <span className="block truncate text-[11px] text-faint">{template.title}</span>
            </button>
            {admin || template.createdBy === me ? (
              <button
                type="button"
                aria-label={`Remove the template ${template.name}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(template.id)}
                className="shrink-0 rounded px-1.5 text-xs text-faint hover:text-danger-soft focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-soft"
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {remove.isError ? (
        <p role="alert" className="text-xs text-danger-soft">
          {(remove.error as Error).message}
        </p>
      ) : null}
    </>
  );
}

function FileFromTemplate({
  workspaceId,
  projectId,
  template,
  onBack,
  onDone,
}: {
  workspaceId: string;
  projectId: string;
  template: IssueTemplate;
  onBack: () => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(startingTitle(template.title));
  const file = useMutation({
    mutationFn: () =>
      call(contracts['issueTemplates.file'], {
        params: { workspaceId, templateId: template.id },
        body: { projectId, title: title.trim() },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['issues', workspaceId, projectId] });
      onDone();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (title.trim()) file.mutate();
  }

  return (
    <form onSubmit={submit} aria-label={`File from ${template.name}`} className="space-y-2">
      <p className="text-xs text-faint">
        From <span className="text-content">{template.name}</span>
        {template.priority !== 'NONE' ? `, ${template.priority.toLowerCase()} priority` : ''}
        {template.labelIds.length > 0
          ? `, ${template.labelIds.length} ${template.labelIds.length === 1 ? 'label' : 'labels'}`
          : ''}
        .
      </p>
      <input
        // biome-ignore lint/a11y/noAutofocus: the title is the one thing to finish here
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        aria-label="Title"
        maxLength={200}
        className={FIELD}
      />
      {template.description ? (
        <p className="line-clamp-3 whitespace-pre-wrap text-[11px] text-faint">
          {template.description}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        {file.isError ? (
          <p role="alert" className="mr-auto text-xs text-danger-soft">
            {(file.error as Error).message}
          </p>
        ) : null}
        <button type="button" onClick={onBack} className="text-xs text-faint hover:text-content">
          Back
        </button>
        <button
          type="submit"
          disabled={!title.trim() || file.isPending}
          className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
        >
          File it
        </button>
      </div>
    </form>
  );
}
