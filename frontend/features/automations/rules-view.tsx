'use client';

import { type AutomationAction, contracts } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { EmptyView } from '../../components/empty-view.tsx';
import { call } from '../../lib/api.ts';
import { type Rule, ruleSentence, runsLine, TRIGGER_LABELS } from './rule-model.ts';

/**
 * The rules page (B9), for administrators: every rule as one sentence,
 * with a month of what it did, a switch and a delete; and a form for a new
 * one with one condition and one action, which covers most rules.
 */

const KEY = (workspaceId: string) => ['automations', workspaceId] as const;
const FIELD =
  'w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-content focus:border-accent-soft focus:outline-none';
const QUIET =
  'rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:bg-surface hover:text-content disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft';

type Member = { userId: string; name: string };

function useNames(workspaceId: string) {
  const members = useQuery({
    queryKey: ['members', workspaceId],
    queryFn: () => call(contracts['members.list'], { params: { workspaceId } }),
  });
  const list = (members.data?.members ?? []) as Member[];
  return { list, nameOf: (id: string) => list.find((m) => m.userId === id)?.name ?? 'someone' };
}

function RuleRow({
  workspaceId,
  rule,
  nameOf,
}: {
  workspaceId: string;
  rule: Rule;
  nameOf: (id: string) => string;
}) {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: KEY(workspaceId) });
  const toggle = useMutation({
    mutationFn: () =>
      call(contracts['automations.update'], {
        params: { workspaceId, ruleId: rule.id },
        body: { enabled: !rule.enabled },
      }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () =>
      call(contracts['automations.delete'], { params: { workspaceId, ruleId: rule.id } }),
    onSuccess: refresh,
  });
  const runs = runsLine(rule.runs);
  return (
    <li
      className={`rounded-xl border border-line bg-raised p-3.5 ${rule.enabled ? '' : 'opacity-60'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-content">{rule.name}</p>
          <p className="mt-0.5 text-pretty text-xs leading-relaxed text-muted">
            {ruleSentence(rule, nameOf)}
          </p>
          {runs ? <p className="mt-1 text-xs text-faint">{runs}</p> : null}
          {rule.action.kind === 'webhook' && rule.action.secret ? (
            <p className="mt-1 break-all font-mono text-[11px] text-faint">
              Signing secret: {rule.action.secret}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            className={QUIET}
            disabled={toggle.isPending}
            onClick={() => toggle.mutate()}
          >
            {rule.enabled ? 'Turn off' : 'Turn on'}
          </button>
          <button
            type="button"
            className={QUIET}
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}

type Draft = {
  name: string;
  trigger: Rule['trigger'];
  field: '' | 'status' | 'priority' | 'label' | 'title';
  value: string;
  action: AutomationAction['kind'];
  text: string;
};

const START: Draft = {
  name: '',
  trigger: 'issue.created',
  field: '',
  value: '',
  action: 'set_priority',
  text: '',
};

/** The action the form describes, from its one free field. */
function actionOf(draft: Draft): AutomationAction {
  switch (draft.action) {
    case 'set_status':
      return { kind: 'set_status', status: (draft.text || 'IN_PROGRESS') as never };
    case 'set_priority':
      return { kind: 'set_priority', priority: (draft.text || 'HIGH') as never };
    case 'comment':
      return { kind: 'comment', body: draft.text };
    case 'notify':
      return { kind: 'notify', who: 'assignee', message: draft.text };
    case 'webhook':
      return { kind: 'webhook', url: draft.text };
    default:
      return { kind: 'assign', userId: draft.text || null };
  }
}

const ACTION_HINTS: Partial<Record<AutomationAction['kind'], string>> = {
  set_status: 'TODO, IN_PROGRESS, IN_REVIEW, DONE or CANCELED',
  set_priority: 'NONE, LOW, MEDIUM, HIGH or URGENT',
  comment: 'What the comment says',
  notify: 'What the assignee is told',
  webhook: 'https://…',
};

function NewRule({ workspaceId, members }: { workspaceId: string; members: Member[] }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<Draft>(START);
  const set = (fields: Partial<Draft>) => setDraft((current) => ({ ...current, ...fields }));
  const create = useMutation({
    mutationFn: () =>
      call(contracts['automations.create'], {
        params: { workspaceId },
        body: {
          name: draft.name,
          trigger: draft.trigger,
          conditions:
            draft.field && draft.value
              ? [{ field: draft.field, op: 'is', value: draft.value }]
              : [],
          action: actionOf(draft),
          enabled: true,
        },
      }),
    onSuccess: () => {
      setDraft(START);
      void client.invalidateQueries({ queryKey: KEY(workspaceId) });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };
  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-xl border border-line bg-raised p-4"
      aria-labelledby="new-rule"
    >
      <h2 id="new-rule" className="text-sm font-semibold text-content">
        A new rule
      </h2>
      <label className="block text-xs text-faint">
        Name
        <input
          className={FIELD}
          required
          maxLength={80}
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-xs text-faint">
          When
          <select
            className={FIELD}
            value={draft.trigger}
            onChange={(e) => set({ trigger: e.target.value as Draft['trigger'] })}
          >
            {Object.entries(TRIGGER_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-faint">
          And its
          <select
            className={FIELD}
            value={draft.field}
            onChange={(e) => set({ field: e.target.value as Draft['field'] })}
          >
            <option value="">(no condition)</option>
            <option value="status">status is</option>
            <option value="priority">priority is</option>
            <option value="label">label is</option>
            <option value="title">title is</option>
          </select>
        </label>
        <label className="block text-xs text-faint">
          Value
          <input
            className={FIELD}
            disabled={!draft.field}
            value={draft.value}
            onChange={(e) => set({ value: e.target.value })}
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-xs text-faint">
          Then
          <select
            className={FIELD}
            value={draft.action}
            onChange={(e) => set({ action: e.target.value as Draft['action'], text: '' })}
          >
            <option value="set_priority">set the priority</option>
            <option value="set_status">set the status</option>
            <option value="assign">assign it</option>
            <option value="comment">comment on it</option>
            <option value="notify">tell its assignee</option>
            <option value="webhook">send a webhook</option>
          </select>
        </label>
        <div className="block text-xs text-faint sm:col-span-2">
          <label htmlFor="rule-action-value">{draft.action === 'assign' ? 'To' : 'With'}</label>
          {draft.action === 'assign' ? (
            <select
              id="rule-action-value"
              className={FIELD}
              value={draft.text}
              onChange={(e) => set({ text: e.target.value })}
            >
              <option value="">nobody</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="rule-action-value"
              className={FIELD}
              placeholder={ACTION_HINTS[draft.action]}
              value={draft.text}
              onChange={(e) => set({ text: e.target.value })}
            />
          )}
        </div>
      </div>
      {create.isError ? (
        <p role="alert" className="text-xs text-danger-soft">
          {(create.error as Error).message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={create.isPending}
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        Add the rule
      </button>
    </form>
  );
}

export function RulesView({ workspaceId }: { workspaceId: string }) {
  const rules = useQuery({
    queryKey: KEY(workspaceId),
    queryFn: () => call(contracts['automations.list'], { params: { workspaceId } }),
  });
  const { list, nameOf } = useNames(workspaceId);
  return (
    <div className="space-y-5">
      {rules.isError ? (
        <p role="alert" className="text-sm text-muted">
          The rules could not be loaded. Try again in a moment.
        </p>
      ) : (rules.data?.rules ?? []).length === 0 && !rules.isPending ? (
        <EmptyView view="rules" workspaceId={workspaceId} />
      ) : (
        <ul className="space-y-2.5">
          {(rules.data?.rules ?? []).map((rule) => (
            <RuleRow key={rule.id} workspaceId={workspaceId} rule={rule} nameOf={nameOf} />
          ))}
        </ul>
      )}
      <NewRule workspaceId={workspaceId} members={list} />
      <p className="max-w-[65ch] text-xs leading-relaxed text-faint">
        Rules run a moment after the change, once each, and the activity feed names the rule. A rule
        never acts on its own change, and rules setting each other off stop three deep. A webhook
        sends only the ids of what happened, signed with the secret shown on its rule, and never to
        an address inside a private network.
      </p>
    </div>
  );
}
