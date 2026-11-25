'use client';

import {
  BOARD_COLUMNS,
  type BoardFilter,
  contracts,
  ISSUE_PRIORITIES,
  type IssuePriority,
  type IssueStatus,
} from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { DeleteButton } from '../../components/delete-button.tsx';
import { priorityLabel, statusLabel } from '../../components/ui/badges.tsx';
import { call } from '../../lib/api.ts';
import { isFiltered, sameFilter, withField } from '../../lib/board-filter.ts';
import { useCycles } from '../cycles/use-cycles.ts';
import { useReleases } from '../releases/use-releases.ts';

/**
 * The board's filter bar (C1): narrow by status, priority, assignee and
 * label, pick a saved view, and (for members) keep the current filter as a
 * view of its own. The filter itself lives in the URL; this only edits it.
 */

const FIELD_CLASS =
  'rounded-md border border-line bg-surface px-2 py-1 text-xs text-muted outline-none transition focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60';
const QUIET_BUTTON =
  'rounded px-1.5 py-0.5 text-xs text-muted transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-soft disabled:opacity-50';

type Option = { value: string; label: string };

export function BoardFilters({
  workspaceId,
  projectId,
  filter,
  onChange,
  canEdit,
  labels,
}: {
  workspaceId: string;
  projectId: string;
  filter: BoardFilter;
  onChange: (next: BoardFilter) => void;
  canEdit: boolean;
  labels: readonly { id: string; name: string }[];
}) {
  const members = useQuery({
    queryKey: ['members', workspaceId],
    queryFn: () => call(contracts['members.list'], { params: { workspaceId } }),
  });

  const statuses: Option[] = BOARD_COLUMNS.map((s: IssueStatus) => ({
    value: s,
    label: statusLabel(s),
  }));
  const priorities: Option[] = ISSUE_PRIORITIES.map((p: IssuePriority) => ({
    value: p,
    label: priorityLabel(p),
  }));
  const people: Option[] = (members.data?.members ?? []).map((m) => ({
    value: m.userId,
    label: m.name,
  }));
  const labelOptions: Option[] = labels.map((l) => ({ value: l.id, label: l.name }));
  const cycles = useCycles(workspaceId, projectId);
  const cycleOptions: Option[] = (cycles.data?.cycles ?? []).map((c) => ({
    value: c.id,
    label: c.name,
  }));
  const releases = useReleases(workspaceId);
  const releaseOptions: Option[] = (releases.data?.releases ?? []).map((r) => ({
    value: r.id,
    label: r.name,
  }));

  return (
    <fieldset className="mt-6 flex flex-wrap items-center gap-2">
      <legend className="sr-only">Filter the board</legend>
      <SavedViews
        workspaceId={workspaceId}
        projectId={projectId}
        filter={filter}
        onChange={onChange}
        canEdit={canEdit}
      />
      <FilterSelect
        label="Status"
        shortcut="filter"
        any="Any status"
        value={filter.status}
        options={statuses}
        onChange={(v) => onChange(withField(filter, 'status', v))}
      />
      <FilterSelect
        label="Priority"
        any="Any priority"
        value={filter.priority}
        options={priorities}
        onChange={(v) => onChange(withField(filter, 'priority', v))}
      />
      <FilterSelect
        label="Assignee"
        any="Anyone"
        value={filter.assigneeId}
        options={people}
        onChange={(v) => onChange(withField(filter, 'assigneeId', v))}
      />
      <FilterSelect
        label="Label"
        any="Any label"
        value={filter.labelId}
        options={labelOptions}
        onChange={(v) => onChange(withField(filter, 'labelId', v))}
      />
      {cycleOptions.length > 0 ? (
        <FilterSelect
          label="Cycle"
          any="Any cycle"
          value={filter.cycleId}
          options={cycleOptions}
          onChange={(v) => onChange(withField(filter, 'cycleId', v))}
        />
      ) : null}
      {cycleOptions.length > 0 ? (
        <FilterSelect
          label="Carried"
          any="Any work"
          value={filter.carried}
          options={CARRIED_OPTIONS}
          onChange={(v) => onChange(withField(filter, 'carried', v))}
        />
      ) : null}
      {releaseOptions.length > 0 ? (
        <FilterSelect
          label="Release"
          any="Any release"
          value={filter.releaseId}
          options={releaseOptions}
          onChange={(v) => onChange(withField(filter, 'releaseId', v))}
        />
      ) : null}
      {isFiltered(filter) && (
        <button type="button" onClick={() => onChange({})} className={QUIET_BUTTON}>
          Clear filters
        </button>
      )}
    </fieldset>
  );
}

/** Work moved on from an earlier cycle unfinished: what keeps slipping. */
const CARRIED_OPTIONS: Option[] = [{ value: 'yes', label: 'Carried over' }];

function FilterSelect({
  label,
  shortcut,
  any,
  value,
  options,
  onChange,
}: {
  label: string;
  /** The board key (C2) that jumps here. */
  shortcut?: string;
  any: string;
  value: string | undefined;
  options: readonly Option[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      data-shortcut={shortcut}
      className={[FIELD_CLASS, value ? 'border-accent/60 text-content' : ''].join(' ')}
    >
      <option value="">{any}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** The project's saved views: pick one, keep the current filter, or delete the one in use. */
function SavedViews({
  workspaceId,
  projectId,
  filter,
  onChange,
  canEdit,
}: {
  workspaceId: string;
  projectId: string;
  filter: BoardFilter;
  onChange: (next: BoardFilter) => void;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const key = ['views', workspaceId, projectId];
  const views = useQuery({
    queryKey: key,
    queryFn: () => call(contracts['savedViews.list'], { params: { workspaceId, projectId } }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const remove = useMutation({
    mutationFn: (viewId: string) =>
      call(contracts['savedViews.delete'], { params: { workspaceId, viewId } }),
    onSuccess: refresh,
  });

  const all = views.data?.views ?? [];
  // Filters are unique per project, so at most one view matches; the bare
  // board is never a view.
  const current = isFiltered(filter)
    ? all.find((view) => sameFilter(view.filter, filter))
    : undefined;

  let action: ReactNode = null;
  if (canEdit && current) {
    action = (
      <DeleteButton
        kind="saved view"
        name={current.name}
        onConfirm={() => remove.mutateAsync(current.id).then(() => undefined)}
      />
    );
  } else if (canEdit && isFiltered(filter)) {
    action = (
      <SaveView workspaceId={workspaceId} projectId={projectId} filter={filter} onSaved={refresh} />
    );
  }

  return (
    <>
      {all.length > 0 && (
        <select
          value={current?.id ?? ''}
          onChange={(event) => {
            const view = all.find((v) => v.id === event.target.value);
            onChange(view ? view.filter : {});
          }}
          aria-label="Saved view"
          data-shortcut="views"
          className={[FIELD_CLASS, current ? 'border-accent/60 text-content' : ''].join(' ')}
        >
          <option value="">
            {isFiltered(filter) && !current ? 'Unsaved filter' : 'All issues'}
          </option>
          {all.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
            </option>
          ))}
        </select>
      )}
      {action}
      {remove.error && (
        <p role="alert" className="w-full text-xs text-danger-soft">
          {(remove.error as Error).message}
        </p>
      )}
    </>
  );
}

/** Name the current filter and keep it as a view. */
function SaveView({
  workspaceId,
  projectId,
  filter,
  onSaved,
}: {
  workspaceId: string;
  projectId: string;
  filter: BoardFilter;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const save = useMutation({
    mutationFn: () =>
      call(contracts['savedViews.create'], {
        params: { workspaceId, projectId },
        body: { name: name.trim(), filter },
      }),
    onSuccess: () => {
      setName('');
      setOpen(false);
      onSaved();
    },
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        // The board's V key (C2) lands here when there is no view to pick yet.
        data-shortcut="views"
        className={QUIET_BUTTON}
      >
        Save view…
      </button>
    );
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) save.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        name="view-name"
        autoComplete="off"
        maxLength={60}
        // biome-ignore lint/a11y/noAutofocus: opened on purpose by the button just pressed
        autoFocus
        placeholder="Name it, e.g. My urgent work…"
        aria-label="View name"
        className={`${FIELD_CLASS} min-w-48`}
      />
      <button
        type="submit"
        disabled={save.isPending || !name.trim()}
        className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
      >
        {save.isPending ? 'Saving…' : 'Save'}
      </button>
      <button
        type="button"
        onClick={() => {
          save.reset();
          setOpen(false);
        }}
        className={QUIET_BUTTON}
      >
        Cancel
      </button>
      {save.error && (
        <p role="alert" className="w-full text-xs text-danger-soft">
          {(save.error as Error).message}
        </p>
      )}
    </form>
  );
}
