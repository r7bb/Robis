'use client';

import { contracts, EXPORT_KEEP_DAYS, EXPORT_LINK_MINUTES } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, InlineError } from '../../components/ui/primitives.tsx';
import { ApiError, call } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/i18n/format.ts';

/**
 * Export the workspace (C6), for admins: ask, wait while a job builds the
 * zip, then download it once. The download button makes a fresh link that
 * works once, for a few minutes, so nothing lasting is ever on the page.
 */

/** How often the list is read again while an export is being built. */
const BUILDING_POLL_MS = 3_000;

const STATUS_TEXT = {
  pending: 'Being built',
  ready: 'Ready to download, once',
  failed: 'Failed',
  downloaded: 'Downloaded',
  expired: 'Expired, file removed',
} as const;

function size(bytes: number | null) {
  if (bytes === null) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const when = (iso: string) => formatDateTime(iso);

export function ExportsPanel({ workspaceId }: { workspaceId: string }) {
  const client = useQueryClient();
  const key = ['exports', workspaceId];
  const list = useQuery({
    queryKey: key,
    queryFn: () => call(contracts['exports.list'], { params: { workspaceId } }),
    refetchInterval: (query) =>
      query.state.data?.exports.some((e) => e.status === 'pending') ? BUILDING_POLL_MS : false,
  });
  const refresh = () => client.invalidateQueries({ queryKey: key });
  const ask = useMutation({
    mutationFn: () => call(contracts['exports.create'], { params: { workspaceId } }),
    onSuccess: refresh,
  });
  const download = useMutation({
    mutationFn: (exportId: string) =>
      call(contracts['exports.link'], { params: { workspaceId, exportId } }),
    onSuccess: ({ url }) => {
      window.location.assign(url);
      // The link is spent as the download starts; show it as downloaded.
      setTimeout(refresh, BUILDING_POLL_MS);
    },
  });

  const rows = list.data?.exports ?? [];
  const building = rows.some((e) => e.status === 'pending');
  const error = ask.error ?? download.error;

  return (
    <section id="exports" aria-labelledby="exports-heading" className="scroll-mt-6">
      <h2 id="exports-heading" className="text-sm font-medium uppercase tracking-wide text-faint">
        Export
      </h2>
      <p className="mt-1 max-w-prose text-sm text-muted">
        Everything this workspace holds, as JSON lines with its images, in one zip. It is built in
        the background and kept for {EXPORT_KEEP_DAYS} days; the download works once, from a link
        that lasts {EXPORT_LINK_MINUTES} minutes. Members appear by name and username; email
        addresses and webhook secrets are left out.
      </p>
      <Button
        variant="secondary"
        className="mt-3"
        disabled={building || ask.isPending}
        onClick={() => ask.mutate()}
      >
        {building ? 'Building the export…' : 'Export everything'}
      </Button>
      {error ? (
        <div className="mt-2">
          <InlineError>
            {error instanceof ApiError ? error.message : 'That did not work. Try again.'}
          </InlineError>
        </div>
      ) : null}
      {rows.length > 0 ? (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-raised">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm"
            >
              <span className="text-content">
                {when(row.createdAt)}
                <span className="ml-2 text-xs text-faint">
                  {STATUS_TEXT[row.status]}
                  {row.bytes !== null ? ` · ${size(row.bytes)}` : ''}
                  {row.error ? ` · ${row.error}` : ''}
                </span>
              </span>
              {row.status === 'ready' ? (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={download.isPending}
                  onClick={() => download.mutate(row.id)}
                >
                  Download
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
