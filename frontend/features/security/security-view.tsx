'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ago } from '../../components/activity-feed.tsx';
import { Button, InlineError } from '../../components/ui/primitives.tsx';
import { type AuditEvent, type AuditPage, api, type Member } from '../../lib/api.ts';
import { describeEvent } from '../../lib/audit-events.ts';
import { ChainStatus } from './chain-status.tsx';

/**
 * The full audit trail, for administrators: who did what, filterable,
 * with the chain's status above it and an export of the whole thing.
 */

const PAGE_SIZE = 50;
/** The largest page the API serves, so an export takes as few requests as it can. */
const EXPORT_PAGE_SIZE = 500;

const ENTITY_TYPES = [
  'workspace',
  'member',
  'project',
  'issue',
  'comment',
  'document',
  'channel',
  'message',
  'meeting',
] as const;

type Filters = { actorId: string; entityType: string };

function query(filters: Filters, cursor: Record<string, number>, limit: number): string {
  const params = new URLSearchParams({ limit: String(limit) });
  for (const [key, value] of Object.entries(cursor)) params.set(key, String(value));
  if (filters.actorId) params.set('actorId', filters.actorId);
  if (filters.entityType) params.set('entityType', filters.entityType);
  return params.toString();
}

/**
 * Walk the trail oldest first and hand it over as JSON lines, one event per
 * line: the format log pipelines ingest without a custom parser.
 */
async function exportTrail(workspaceId: string, filters: Filters) {
  const lines: string[] = [];
  let after = 0;

  for (;;) {
    const page = await api<AuditPage>(
      `/workspaces/${workspaceId}/audit/events?${query(filters, { after }, EXPORT_PAGE_SIZE)}`,
    );
    for (const { actorName: _name, ...event } of page.events) lines.push(JSON.stringify(event));
    if (page.nextCursor === null) break;
    after = page.nextCursor;
  }

  const blob = new Blob([`${lines.join('\n')}\n`], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `robis-audit-${workspaceId}.jsonl`;
  link.click();
  // Revoked on the next turn: some browsers cancel a download whose URL is
  // revoked in the same tick as the click.
  setTimeout(() => URL.revokeObjectURL(url), 0);

  return lines.length;
}

function EventRow({ event }: { event: AuditEvent }) {
  return (
    <li className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 px-4 py-3 text-sm sm:grid-cols-[3.5rem_minmax(0,1fr)_auto]">
      <span className="font-mono text-xs tabular-nums text-faint">#{event.seq}</span>

      <span className="min-w-0">
        <span className="font-medium text-content">{event.actorName ?? 'Someone'}</span>
        {event.actor.kind !== 'human' ? (
          <span className="ml-1.5 rounded bg-raised px-1 py-0.5 text-[10px] uppercase tracking-wide text-faint">
            {event.actor.kind}
          </span>
        ) : null}{' '}
        <span className="text-muted">{describeEvent(event.type, event.payload)}</span>
        <span className="mt-0.5 block font-mono text-[11px] text-faint">
          {event.type}
          {event.requestId ? (
            <span title="Request id, to match against server logs"> · {event.requestId}</span>
          ) : null}
        </span>
      </span>

      <time
        dateTime={event.occurredAt}
        title={new Date(event.occurredAt).toLocaleString()}
        className="col-start-2 text-xs text-faint sm:col-start-auto"
      >
        {ago(event.occurredAt)}
      </time>
    </li>
  );
}

export function SecurityView({ workspaceId }: { workspaceId: string }) {
  const [filters, setFilters] = useState<Filters>({ actorId: '', entityType: '' });
  const [exporting, setExporting] = useState<string | null>(null);

  const members = useQuery({
    queryKey: ['members', workspaceId],
    queryFn: () => api<{ members: Member[] }>(`/workspaces/${workspaceId}/members`),
  });

  const trail = useInfiniteQuery({
    queryKey: ['audit-events', workspaceId, filters],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) =>
      api<AuditPage>(
        `/workspaces/${workspaceId}/audit/events?${query(
          filters,
          pageParam === null ? {} : { before: pageParam },
          PAGE_SIZE,
        )}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });

  async function onExport() {
    setExporting('Exporting…');
    try {
      const count = await exportTrail(workspaceId, filters);
      setExporting(`Exported ${count} ${count === 1 ? 'event' : 'events'}.`);
    } catch (error) {
      setExporting(`Export failed: ${(error as Error).message}`);
    }
  }

  const events = trail.data?.pages.flatMap((page) => page.events) ?? [];
  const selectClass =
    'rounded-md border border-line bg-raised px-2 py-1.5 text-sm text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft';

  return (
    <div className="mt-6 space-y-6">
      <ChainStatus workspaceId={workspaceId} />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-faint">
          Who
          <select
            className={selectClass}
            value={filters.actorId}
            onChange={(event) => setFilters({ ...filters, actorId: event.target.value })}
          >
            <option value="">Anyone</option>
            {(members.data?.members ?? []).map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-faint">
          What
          <select
            className={selectClass}
            value={filters.entityType}
            onChange={(event) => setFilters({ ...filters, entityType: event.target.value })}
          >
            <option value="">Everything</option>
            {ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type[0]!.toUpperCase() + type.slice(1)}s
              </option>
            ))}
          </select>
        </label>

        <div className="ml-auto flex items-center gap-3">
          {exporting ? (
            <span aria-live="polite" className="text-xs text-faint">
              {exporting}
            </span>
          ) : null}
          <Button size="sm" onClick={onExport} disabled={exporting === 'Exporting…'}>
            Export JSON lines
          </Button>
        </div>
      </div>

      {trail.isError ? <InlineError>{(trail.error as Error).message}</InlineError> : null}

      {events.length === 0 && trail.isSuccess ? (
        <p className="rounded-lg border border-line bg-raised px-4 py-6 text-center text-sm text-faint">
          Nothing matches. Try a wider filter.
        </p>
      ) : null}

      <ul className="divide-y divide-line rounded-lg border border-line bg-surface empty:hidden">
        {events.map((event) => (
          <EventRow key={event.key} event={event} />
        ))}
      </ul>

      {trail.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => trail.fetchNextPage()}
            disabled={trail.isFetchingNextPage}
          >
            {trail.isFetchingNextPage ? 'Loading…' : 'Older events'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
