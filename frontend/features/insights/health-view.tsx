'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';
import { acceptanceTile, healthKey, queueTile, readingTile, type Tile } from './health-model.ts';

/** The timings are written a minute at a time, so asking more often shows nothing new. */
const REFRESH_MS = 60_000;

/**
 * Health (Phase 6) for workspace admins: a month of this workspace's hint
 * answers and, for the people who run the server, its job queue as it is
 * now and a day of sync lag and live-update timings. All from instruments the
 * services keep as they work; below the minimum sample, counts in words.
 */
export function HealthSection({ workspaceId }: { workspaceId: string }) {
  const health = useQuery({
    queryKey: healthKey(workspaceId),
    queryFn: () => call(contracts['insights.health'], { params: { workspaceId } }),
    refetchInterval: REFRESH_MS,
  });

  return (
    <section aria-labelledby="health-heading" className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="health-heading" className="text-sm font-semibold text-content">
          System health
        </h2>
        <p className="text-xs text-faint">From what the services record as they work</p>
      </div>
      {health.isPending ? (
        <div
          role="status"
          aria-busy="true"
          aria-label="Reading the instruments"
          className="mt-3 h-40 animate-pulse rounded-xl border border-line bg-raised motion-reduce:animate-none"
        />
      ) : !health.data ? (
        <p role="alert" className="mt-3 text-sm text-muted">
          The instruments could not be read just now. Try again in a moment.
        </p>
      ) : (
        <>
          {health.data.server ? (
            <ul className="mt-3 grid gap-2.5 sm:grid-cols-3">
              <HealthTile label="Job queue" tile={queueTile(health.data.server.queue)} />
              <HealthTile
                label="Sync lag"
                tile={readingTile(health.data.server.syncLag, health.data)}
              />
              <HealthTile
                label="Live updates"
                tile={readingTile(health.data.server.fanOut, health.data)}
              />
            </ul>
          ) : null}
          <ul className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
            <HealthTile
              label="Duplicate hints"
              tile={acceptanceTile(
                health.data.suggestions.duplicate,
                health.data.suggestions.days,
                health.data.minSample,
              )}
            />
            <HealthTile
              label="Priority hints"
              tile={acceptanceTile(
                health.data.suggestions.priority,
                health.data.suggestions.days,
                health.data.minSample,
              )}
            />
          </ul>
          <p className="mt-3 max-w-[65ch] text-xs leading-relaxed text-faint">
            {health.data.server
              ? 'The queue and the timings are this server’s, so they cover every workspace on it, in counts only. Sync lag is how long a change waited in a browser before the server took it, as the browser reports it; live updates, from a change being saved to reaching open tabs, across two clocks. '
              : 'The server’s own queue and timings are shown to the people who run it. '}
            Hints are this workspace&apos;s, with nobody named.
          </p>
        </>
      )}
    </section>
  );
}

function HealthTile({ label, tile }: { label: string; tile: Tile }) {
  return (
    <li className="rounded-xl border border-line bg-raised p-3.5">
      <p className="text-xs text-faint">{label}</p>
      {tile.figure ? (
        <p className="mt-0.5 text-lg font-semibold tracking-tight tabular-nums text-content">
          {tile.figure}
        </p>
      ) : null}
      <p className="mt-1 text-pretty text-xs leading-relaxed text-muted">{tile.line}</p>
    </li>
  );
}
