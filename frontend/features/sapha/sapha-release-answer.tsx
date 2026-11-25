'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { call } from '../../lib/api.ts';
import { dateFormat } from '../../lib/i18n/format.ts';
import { issueHref } from '../../lib/links.ts';
import { searchHref } from '../../lib/search-links.ts';
import { useReleases } from '../releases/use-releases.ts';
import { releaseAsked } from './release-answer-model.ts';

/** How many of a release's open issues the answer names. */
const OPEN_LISTED = 5;
const UNDER_WAY = new Set(['IN_PROGRESS', 'IN_REVIEW']);
const FINISHED = new Set(['DONE', 'CANCELED']);

const dayName = (day: string) =>
  dateFormat({ weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${day}T12:00`));

/**
 * How a release is going, the one named or else the next to ship: done of
 * planned, the day it is aimed at or shipped, and the first few issues still
 * open, work under way first, each a link.
 */
export function ReleaseAnswer({
  workspaceId,
  name,
  onClose,
}: {
  workspaceId: string;
  name: string | null;
  onClose: () => void;
}) {
  const releases = useReleases(workspaceId);
  const asked = releases.data ? releaseAsked(releases.data.releases, name) : null;
  const detail = useQuery({
    queryKey: ['release', workspaceId, asked?.id],
    queryFn: () =>
      call(contracts['releases.get'], { params: { workspaceId, releaseId: asked!.id } }),
    enabled: Boolean(asked),
  });

  if (releases.isPending) return <p className="text-sm text-faint">Looking…</p>;
  if (releases.isError) {
    return (
      <p role="alert" className="text-sm text-danger-soft">
        {(releases.error as Error).message}
      </p>
    );
  }
  if (!asked) {
    return (
      <div role="status" className="space-y-1.5">
        <p className="text-base text-content">
          {name ? `No release here is called ${name}.` : 'No release is waiting to ship.'}
        </p>
        {name ? (
          <Link
            href={searchHref(workspaceId, name)}
            onClick={onClose}
            className="inline-block text-sm text-accent-soft hover:underline"
          >
            Search for “{name}” instead
          </Link>
        ) : null}
      </div>
    );
  }
  const counted = asked.total - asked.canceled;
  const open = (detail.data?.issues ?? [])
    .filter((issue) => !FINISHED.has(issue.status))
    .sort((a, b) => Number(UNDER_WAY.has(b.status)) - Number(UNDER_WAY.has(a.status)));
  const when = asked.shippedAt
    ? `shipped ${dayName(asked.shippedAt.slice(0, 10))}`
    : asked.targetOn
      ? `aimed at ${dayName(asked.targetOn)}`
      : 'no day set';

  return (
    <div role="status" className="space-y-1.5">
      <p className="text-base text-content">{asked.name}</p>
      <p className="text-sm text-muted">
        {asked.done} of {counted} done · {when}
        {open.length > 0 ? ` · ${open.length} still open` : ''}
      </p>
      {open.length > 0 ? (
        <ul className="space-y-1">
          {open.slice(0, OPEN_LISTED).map((issue) => (
            <li key={issue.id} className="text-sm">
              <Link
                href={issueHref(workspaceId, issue.id)}
                onClick={onClose}
                className="text-content hover:underline"
              >
                <span className="mr-1.5 font-mono text-xs text-faint">{issue.key}</span>
                {issue.title}
                {UNDER_WAY.has(issue.status) ? (
                  <span className="ml-1.5 text-xs text-faint">under way</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <Link
        href={`/workspaces/${workspaceId}/releases`}
        onClick={onClose}
        className="inline-block text-sm text-accent-soft hover:underline"
      >
        Open releases
      </Link>
    </div>
  );
}
