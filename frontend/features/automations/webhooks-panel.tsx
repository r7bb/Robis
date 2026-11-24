'use client';

import { contracts, WEBHOOK_EVENT_NAMES, type WebhookEvent } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { DeleteButton } from '../../components/delete-button.tsx';
import { Button, InlineError } from '../../components/ui/primitives.tsx';
import { ApiError, call } from '../../lib/api.ts';

/**
 * Outgoing webhooks (C7), for admins: an https address and the events it
 * wants, its secret shown once, and each webhook's delivery log. Payloads
 * carry ids, never words; see How it works for checking a signature.
 */

const EVENT_TEXT: Record<WebhookEvent, string> = {
  'issue.created': 'An issue is filed',
  'issue.updated': 'An issue is changed',
  'issue.status_changed': 'An issue moves',
  'issue.deleted': 'An issue is deleted',
  'comment.created': 'A comment is left',
  'project.created': 'A board is made',
  'document.created': 'A document is made',
  'meeting.created': 'A meeting is scheduled',
  'member.joined': 'Someone joins',
  'member.removed': 'Someone is removed',
};

const FIELD =
  'w-full rounded-md border border-line bg-raised px-3 py-2 text-sm text-content outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60';

const messageOf = (error: unknown) =>
  error instanceof ApiError ? error.message : 'That did not work. Try again.';

function Deliveries({ workspaceId, webhookId }: { workspaceId: string; webhookId: string }) {
  const log = useQuery({
    queryKey: ['webhook-deliveries', webhookId],
    queryFn: () => call(contracts['webhooks.deliveries'], { params: { workspaceId, webhookId } }),
  });
  const rows = log.data?.deliveries ?? [];
  if (log.isPending) return <p className="mt-2 text-xs text-faint">Loading…</p>;
  if (rows.length === 0) return <p className="mt-2 text-xs text-faint">Nothing sent yet.</p>;
  return (
    <ul className="mt-2 space-y-1 text-xs">
      {rows.map((d) => (
        <li key={d.id} className="flex flex-wrap gap-x-2 text-muted">
          <span className="font-mono text-faint">{d.eventType}</span>
          <span className={d.status === 'failed' ? 'text-danger-soft' : 'text-content'}>
            {d.status}
          </span>
          <span>
            {d.attempts} {d.attempts === 1 ? 'try' : 'tries'}
            {d.lastStatusCode ? `, answered ${d.lastStatusCode}` : ''}
          </span>
          {d.lastError ? <span className="text-faint">{d.lastError}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function NewWebhook({ workspaceId, onMade }: { workspaceId: string; onMade: () => void }) {
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>(['issue.created']);
  const [secret, setSecret] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      call(contracts['webhooks.create'], { params: { workspaceId }, body: { url, events } }),
    onSuccess: (made) => {
      setSecret(made.secret);
      setUrl('');
      onMade();
    },
  });
  const toggle = (event: WebhookEvent) =>
    setEvents((list) =>
      list.includes(event) ? list.filter((e) => e !== event) : [...list, event],
    );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-xl border border-line bg-raised p-4"
      aria-labelledby="new-webhook"
    >
      <h3 id="new-webhook" className="text-sm font-semibold text-content">
        A new webhook
      </h3>
      <label className="block text-xs text-faint">
        Address (https)
        <input
          className={`${FIELD} mt-1`}
          required
          placeholder="https://example.com/robis-hook"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <fieldset>
        <legend className="text-xs text-faint">Send when</legend>
        <div className="mt-1 grid gap-1 sm:grid-cols-2">
          {WEBHOOK_EVENT_NAMES.map((event) => (
            <label key={event} className="flex items-center gap-2 text-sm text-content">
              <input
                type="checkbox"
                checked={events.includes(event)}
                onChange={() => toggle(event)}
              />
              {EVENT_TEXT[event]}
            </label>
          ))}
        </div>
      </fieldset>
      <Button type="submit" variant="primary" disabled={create.isPending || events.length === 0}>
        {create.isPending ? 'Adding…' : 'Add webhook'}
      </Button>
      {create.error ? <InlineError>{messageOf(create.error)}</InlineError> : null}
      {secret ? (
        <div
          role="status"
          className="rounded-md border border-accent-soft/40 bg-accent/10 p-3 text-xs"
        >
          <p className="text-content">
            Its signing secret, shown this once. Keep it where the receiver can check signatures:
          </p>
          <code className="mt-1 block break-all font-mono text-content">{secret}</code>
          <Button
            size="sm"
            className="mt-2"
            onClick={() => void navigator.clipboard.writeText(secret)}
          >
            Copy
          </Button>
        </div>
      ) : null}
    </form>
  );
}

export function WebhooksPanel({ workspaceId }: { workspaceId: string }) {
  const client = useQueryClient();
  const key = ['webhooks', workspaceId];
  const list = useQuery({
    queryKey: key,
    queryFn: () => call(contracts['webhooks.list'], { params: { workspaceId } }),
  });
  const refresh = () => client.invalidateQueries({ queryKey: key });
  const update = useMutation({
    mutationFn: ({ webhookId, enabled }: { webhookId: string; enabled: boolean }) =>
      call(contracts['webhooks.update'], { params: { workspaceId, webhookId }, body: { enabled } }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (webhookId: string) =>
      call(contracts['webhooks.delete'], { params: { workspaceId, webhookId } }),
    onSuccess: refresh,
  });
  const [open, setOpen] = useState<string | null>(null);
  const rows = list.data?.webhooks ?? [];

  return (
    <section aria-labelledby="webhooks-heading" className="space-y-4">
      <div>
        <h2 id="webhooks-heading" className="text-sm font-semibold text-content">
          Webhooks
        </h2>
        <p className="mt-1 max-w-[65ch] text-xs leading-relaxed text-faint">
          Tell another system when something happens here. Each delivery is signed with HMAC-SHA256
          over its timestamp and body, and carries an id that stays the same on every retry, so a
          receiver can drop repeats. Payloads hold ids, never words.
        </p>
      </div>
      {list.isError || update.error || remove.error ? (
        <InlineError>{messageOf(list.error ?? update.error ?? remove.error)}</InlineError>
      ) : null}
      {rows.length > 0 ? (
        <ul className="space-y-2.5">
          {rows.map((hook) => (
            <li key={hook.id} className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate font-mono text-xs text-content">{hook.url}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-faint">{hook.enabled ? 'On' : 'Off'}</span>
                  <Button
                    size="sm"
                    aria-label={`${hook.enabled ? 'Turn off' : 'Turn on'} the webhook to ${new URL(hook.url).host}`}
                    onClick={() => update.mutate({ webhookId: hook.id, enabled: !hook.enabled })}
                  >
                    {hook.enabled ? 'Turn off' : 'Turn on'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setOpen(open === hook.id ? null : hook.id)}
                  >
                    {open === hook.id ? 'Hide log' : 'Log'}
                  </Button>
                  <DeleteButton
                    allowed
                    kind="webhook"
                    name={hook.url}
                    cascade="Its delivery log goes with it."
                    onConfirm={() => remove.mutateAsync(hook.id)}
                  />
                </span>
              </div>
              <p className="mt-1 text-xs text-faint">
                {hook.events.map((e) => EVENT_TEXT[e as WebhookEvent] ?? e).join(', ')}
              </p>
              {open === hook.id ? (
                <Deliveries workspaceId={workspaceId} webhookId={hook.id} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <NewWebhook workspaceId={workspaceId} onMade={() => void refresh()} />
    </section>
  );
}
