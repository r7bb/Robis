'use client';

import { useCycles } from './use-cycles.ts';

/** Which of its board's cycles an issue is planned for, or none. */
export function CyclePicker({
  workspaceId,
  projectId,
  value,
  canEdit,
  onChange,
}: {
  workspaceId: string;
  projectId: string;
  value: string | null;
  canEdit: boolean;
  onChange: (cycleId: string | null) => void;
}) {
  const cycles = useCycles(workspaceId, projectId);
  const list = cycles.data?.cycles ?? [];
  if (list.length === 0) {
    return <p className="text-xs text-faint">No cycles on this board yet.</p>;
  }
  return (
    <select
      aria-label="Cycle"
      value={value ?? ''}
      disabled={!canEdit}
      onChange={(event) => onChange(event.target.value || null)}
      className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-content disabled:opacity-60"
    >
      <option value="">Not planned</option>
      {list.map((cycle) => (
        <option key={cycle.id} value={cycle.id}>
          {cycle.name} ({cycle.startsOn} to {cycle.endsOn})
        </option>
      ))}
    </select>
  );
}
