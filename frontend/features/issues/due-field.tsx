'use client';

import { DueChip } from '../../components/ui/due-chip.tsx';

/** An issue's due day (C1): a date field, and how near the day is. */
export function DueField({
  dueOn,
  finished,
  canEdit,
  onChange,
}: {
  dueOn: string | null;
  finished: boolean;
  canEdit: boolean;
  onChange: (dueOn: string | null) => void;
}) {
  return (
    <span className="flex items-center gap-2">
      <input
        type="date"
        value={dueOn ?? ''}
        disabled={!canEdit}
        onChange={(event) => {
          // A day half typed reads as empty; only a whole day, or the
          // field emptied on purpose, is sent.
          if (!event.target.value && event.target.validity.badInput) return;
          onChange(event.target.value || null);
        }}
        aria-label="Due day"
        className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-content outline-none transition focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-60"
      />
      {dueOn && <DueChip dueOn={dueOn} finished={finished} />}
      {dueOn && canEdit && (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Clear the due day"
          className="rounded px-1.5 py-0.5 text-xs text-muted transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-soft"
        >
          Clear
        </button>
      )}
    </span>
  );
}
