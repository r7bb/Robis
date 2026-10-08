'use client';

import { useQuery } from '@tanstack/react-query';
import { type ActivityEvent, api } from '../lib/api.ts';

/**
 * The workspace audit trail.
 *
 * These rows were already being written on every mutation and served by
 * `/workspaces/:id/activity`; nothing rendered them. The trail is append-only
 * and never edited, so this is a read-only view by construction -- there is
 * deliberately no control here to hide or remove an entry.
 *
 * Events are described from stored payloads rather than by refetching the
 * entities they mention. An audit entry has to stay truthful about what
 * happened even after the issue is deleted or the title changes, so it records
 * what the values were at the time rather than pointing at what they are now.
 */

/** One phrasing per event type. Unknown types fall back to the raw name. */
function describe(event: ActivityEvent): string {
  const payload = event.payload;

  switch (event.eventType) {
    case 'issue.created':
      return `created ${payload.key ?? 'an issue'}${payload.title ? ` · ${payload.title}` : ''}`;
    case 'issue.status_changed':
      return `moved ${payload.key ?? 'an issue'} from ${label(payload.from)} to ${label(payload.to)}`;
    case 'project.created':
      return `created the project ${payload.name ?? ''}`.trim();
    case 'project.deleted':
      return `deleted the project ${payload.name ?? ''}`.trim();
    case 'workspace.created':
      return 'created this workspace';
    case 'workspace.updated':
      return 'updated the workspace';
    case 'member.added':
      return `added ${payload.email ?? 'a member'} as ${label(payload.role)}`;
    case 'member.removed':
      return `removed ${payload.email ?? 'a member'}`;
    case 'member.role_changed':
      return `changed ${payload.email ?? 'a member'} from ${label(payload.from)} to ${label(payload.to)}`;
    default:
      // Better to show an unstyled truth than to drop an event because this
      // component has not been taught about it yet.
      return event.eventType;
  }
}

function label(value: string | undefined): string {
  return value ? value.toLowerCase().replaceAll('_', ' ') : 'unknown';
}

/** Relative time, because "3 hours ago" is what a feed is read for. */
function ago(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);

  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.345, 'week'],
    [12, 'month'],
  ];

  let value = seconds;
  let unit: Intl.RelativeTimeFormatUnit = 'second';

  for (const [size, next] of steps) {
    if (value < size) break;
    value /= size;
    unit = next;
  }

  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(
    -Math.floor(value),
    unit,
  );
}

export function ActivityFeed({ workspaceId }: { workspaceId: string }) {
  const activity = useQuery({
    queryKey: ['activity', workspaceId],
    queryFn: () => api<{ events: ActivityEvent[] }>(`/workspaces/${workspaceId}/activity`),
  });

  // Errors stay silent: the feed is supplementary, and a red box here would
  // be louder than the information is worth. An empty trail is a real state
  // rather than a failure -- a workspace created before auditing existed, or
  // one seeded straight into the database, genuinely has no entries.
  if (activity.isError) return null;

  const events = activity.data?.events ?? [];

  return (
    <section className="mt-12">
      <h2 className="text-sm font-medium uppercase tracking-wide text-faint">Activity</h2>

      {events.length === 0 && !activity.isPending && (
        <p className="mt-3 rounded-lg border border-line bg-raised px-4 py-6 text-center text-sm text-faint">
          Nothing recorded yet. Changes to issues, projects and members show up here.
        </p>
      )}

      <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-raised empty:hidden">
        {events.slice(0, 20).map((event) => (
          <li key={event.id} className="flex items-baseline gap-2 px-4 py-2.5 text-sm">
            <span className="font-medium text-content">{event.actorName ?? 'Someone'}</span>
            <span className="min-w-0 flex-1 text-muted">{describe(event)}</span>
            <time
              dateTime={event.createdAt}
              title={new Date(event.createdAt).toLocaleString()}
              className="shrink-0 text-xs text-faint"
            >
              {ago(event.createdAt)}
            </time>
          </li>
        ))}
      </ul>
    </section>
  );
}
