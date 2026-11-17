'use client';

import {
  BOARD_COLUMNS,
  type BulkChange,
  contracts,
  ISSUE_PRIORITIES,
  type IssuePriority,
  type IssueStatus,
} from '@robis/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { DeleteButton } from '../../components/delete-button.tsx';
import { priorityLabel, statusLabel } from '../../components/ui/badges.tsx';
import { call } from '../../lib/api.ts';
import { describeResult } from '../../lib/bulk-result.ts';

/**
 * Actions for the cards picked on the board (C1): one change to all of
 * them in a single request. The server judges each issue on its own and
 * says which it left alone and why; that is shown here, not hidden.
 */

const FIELD_CLASS =
  'rounded-md border border-line bg-surface px-2 py-1 text-xs text-muted outline-none transition focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50';

export function BulkBar({
  workspaceId,
  issueIds,
  online,
  canDelete,
  labels,
  onDone,
}: {
  workspaceId: string;
  issueIds: readonly string[];
  online: boolean;
  canDelete: boolean;
  labels: readonly { id: string; name: string }[];
  onDone: () => void;
}) {
  const members = useQuery({
    queryKey: ['members', workspaceId],
    queryFn: () => call(contracts['members.list'], { params: { workspaceId } }),
  });
  const people = (members.data?.members ?? []).filter((m) => m.kind !== 'agent');

  const apply = useMutation({
    mutationFn: (change: BulkChange) =>
      call(contracts['issues.bulk'], {
        params: { workspaceId },
        body: { issueIds: [...issueIds], change },
      }),
    onSuccess: onDone,
  });

  const disabled = !online || issueIds.length === 0 || apply.isPending;
  // Each select is an action, not a setting: it fires and returns to its prompt.
  const act = (change: BulkChange | null) => {
    if (change) apply.mutate(change);
  };

  return (
    <div className="mt-4 rounded-lg border border-line bg-raised p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-content tabular-nums">{issueIds.length} selected</span>
        <ActionSelect
          label="Move selected to"
          prompt="Move to…"
          disabled={disabled}
          options={BOARD_COLUMNS.map((s: IssueStatus) => ({ value: s, label: statusLabel(s) }))}
          onPick={(v) => act({ kind: 'status', status: v as IssueStatus })}
        />
        <ActionSelect
          label="Set priority of selected"
          prompt="Priority…"
          disabled={disabled}
          options={ISSUE_PRIORITIES.map((p: IssuePriority) => ({
            value: p,
            label: priorityLabel(p),
          }))}
          onPick={(v) => act({ kind: 'priority', priority: v as IssuePriority })}
        />
        <ActionSelect
          label="Assign selected to"
          prompt="Assign…"
          disabled={disabled}
          options={[
            { value: 'none', label: 'Nobody' },
            ...people.map((m) => ({ value: m.userId, label: m.name })),
          ]}
          onPick={(v) => act({ kind: 'assignee', assigneeId: v === 'none' ? null : v })}
        />
        {labels.length > 0 && (
          <ActionSelect
            label="Label selected"
            prompt="Label…"
            disabled={disabled}
            options={labels.flatMap((l) => [
              { value: `add:${l.id}`, label: `Add ${l.name}` },
              { value: `remove:${l.id}`, label: `Remove ${l.name}` },
            ])}
            onPick={(v) => {
              const [how, labelId] = v.split(':') as ['add' | 'remove', string];
              act({ kind: how === 'add' ? 'addLabel' : 'removeLabel', labelId });
            }}
          />
        )}
        {issueIds.length > 0 && online && (
          <DeleteButton
            allowed={canDelete}
            kind="selection"
            name={`${issueIds.length} ${issueIds.length === 1 ? 'issue' : 'issues'}`}
            cascade="Their comments and images go with them."
            onConfirm={() => apply.mutateAsync({ kind: 'delete' }).then(() => undefined)}
          />
        )}
      </div>
      <p className="mt-2 min-h-4 text-xs text-faint" aria-live="polite">
        {!online && 'Changing many issues at once needs a connection.'}
        {online && apply.data && describeResult(apply.data)}
      </p>
      {apply.error && (
        <p role="alert" className="mt-1 text-xs text-danger-soft">
          {(apply.error as Error).message}
        </p>
      )}
    </div>
  );
}

function ActionSelect({
  label,
  prompt,
  disabled,
  options,
  onPick,
}: {
  label: string;
  prompt: string;
  disabled: boolean;
  options: readonly { value: string; label: string }[];
  onPick: (value: string) => void;
}) {
  return (
    <select
      value=""
      disabled={disabled}
      aria-label={label}
      onChange={(event) => {
        if (event.target.value) onPick(event.target.value);
      }}
      className={FIELD_CLASS}
    >
      <option value="">{prompt}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
