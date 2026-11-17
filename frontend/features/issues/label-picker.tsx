'use client';

import { contracts, LABEL_COLOURS, type LabelColour } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { LabelChip } from '../../components/ui/badges.tsx';
import { call } from '../../lib/api.ts';

/**
 * An issue's labels (C1): its chips, and for anyone who may edit it, a list
 * of the workspace's labels to toggle and a field to make a new one.
 */
export function LabelPicker({
  workspaceId,
  issueId,
  current,
  canEdit,
}: {
  workspaceId: string;
  issueId: string;
  current: readonly string[];
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [colour, setColour] = useState<LabelColour>('sky');

  const labels = useQuery({
    queryKey: ['labels', workspaceId],
    queryFn: () => call(contracts['labels.list'], { params: { workspaceId } }),
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['issue', workspaceId, issueId] });
    queryClient.invalidateQueries({ queryKey: ['labels', workspaceId] });
  };

  const set = useMutation({
    mutationFn: (labelIds: string[]) =>
      call(contracts['issues.setLabels'], { params: { workspaceId, issueId }, body: { labelIds } }),
    onSuccess: refresh,
  });
  const create = useMutation({
    mutationFn: () =>
      call(contracts['labels.create'], {
        params: { workspaceId },
        body: { name: name.trim(), colour },
      }),
    onSuccess: ({ label }) => {
      setName('');
      set.mutate([...current, label.id]);
    },
  });

  const all = labels.data?.labels ?? [];
  const mine = all.filter((label) => current.includes(label.id));
  const toggle = (id: string) =>
    set.mutate(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);

  function onCreate(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) create.mutate();
  }

  const error = set.error ?? create.error;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {mine.length === 0 && <span className="text-sm text-faint">No labels</span>}
        {mine.map((label) => (
          <LabelChip key={label.id} name={label.name} colour={label.colour} />
        ))}
        {canEdit && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="rounded px-1.5 py-0.5 text-xs text-muted transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-soft"
          >
            {open ? 'Done' : 'Edit labels'}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2 rounded-lg border border-line bg-raised p-3">
          <ul className="flex flex-wrap gap-2">
            {all.map((label) => (
              <li key={label.id}>
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={current.includes(label.id)}
                    onChange={() => toggle(label.id)}
                    disabled={set.isPending}
                  />
                  <LabelChip name={label.name} colour={label.colour} />
                </label>
              </li>
            ))}
          </ul>
          <form onSubmit={onCreate} className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              name="label-name"
              autoComplete="off"
              maxLength={40}
              placeholder="New label, e.g. Bug…"
              aria-label="New label name"
              className="min-w-40 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-xs outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60"
            />
            <select
              value={colour}
              onChange={(event) => setColour(event.target.value as LabelColour)}
              aria-label="New label colour"
              className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-muted outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {LABEL_COLOURS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={create.isPending || !name.trim()}
              className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
            >
              {create.isPending ? 'Adding…' : 'Add'}
            </button>
          </form>
          {error && (
            <p role="alert" className="mt-2 text-xs text-danger-soft">
              {(error as Error).message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
