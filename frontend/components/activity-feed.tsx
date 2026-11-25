'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { call } from '../lib/api.ts';
import { describeEvent } from '../lib/audit-events.ts';
import { formatDateTime } from '../lib/i18n/format.ts';
import { ago } from '../lib/time.ts';
import { AgentBadge, RuleBadge } from './ui/primitives.tsx';

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

export function ActivityFeed({ workspaceId }: { workspaceId: string }) {
  const activity = useQuery({
    queryKey: ['activity', workspaceId],
    queryFn: () => call(contracts['workspaces.activity'], { params: { workspaceId } }),
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
          Nothing recorded yet. Changes across the workspace show up here.
        </p>
      )}

      <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-raised empty:hidden">
        {events.slice(0, 20).map((event) => (
          // Who and when on the first line, what on the second. On one line
          // a name with an Agent badge left the words a column a few letters
          // wide in the side panel, and they ran under the time.
          <li key={event.id} className="px-4 py-2.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium text-content">
                  {event.actorKind === 'rule' ? 'An automation' : (event.actorName ?? 'Someone')}
                </span>
                {event.actorKind === 'agent' && <AgentBadge />}
                {event.actorKind === 'rule' && <RuleBadge />}
              </span>
              <time
                dateTime={event.createdAt}
                title={formatDateTime(event.createdAt)}
                className="shrink-0 text-xs text-faint"
              >
                {ago(event.createdAt)}
              </time>
            </div>
            <p className="mt-0.5 text-muted">{describeEvent(event.eventType, event.payload)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
