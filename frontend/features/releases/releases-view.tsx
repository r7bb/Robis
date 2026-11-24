'use client';

import { can, contracts, type Role } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { call } from '../../lib/api.ts';
import { dateFormat } from '../../lib/i18n/format.ts';
import { issueHref } from '../../lib/links.ts';
import { useMyId } from '../../lib/use-people.ts';
import { type Release, releasesKey, useReleases } from './use-releases.ts';

const FIELD =
  'rounded-md border border-line bg-surface px-2 py-1 text-sm text-content outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60';

const dayName = (day: string) =>
  dateFormat({ weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${day}T12:00`));

/** "Aimed at Tue 15 Dec", "Shipped Tue 15 Dec", or "No day set". */
function whenLine(release: Release): string {
  if (release.shippedAt) return `Shipped ${dayName(release.shippedAt.slice(0, 10))}`;
  return release.targetOn ? `Aimed at ${dayName(release.targetOn)}` : 'No day set';
}

/**
 * Releases: versions of the work gathered from every board. Each shows
 * how much of it is done; opened, its issues by board, and Ship it, which
 * stamps it and writes its notes from what was done.
 */
export function ReleasesView({
  workspaceId,
  role,
}: {
  workspaceId: string;
  role: Role | undefined;
}) {
  const releases = useReleases(workspaceId);
  const [opened, setOpened] = useState<string | null>(null);
  const canPlan = Boolean(role) && can(role!, 'issue:update');
  const list = releases.data?.releases ?? [];

  return (
    <div className="space-y-6">
      {canPlan ? <NewRelease workspaceId={workspaceId} /> : null}
      {releases.isSuccess && list.length === 0 ? (
        <p className="text-sm text-faint">
          No releases yet. Plan one, then put issues from any board in it from the issue’s Release
          field.
        </p>
      ) : null}
      <ul className="space-y-2">
        {list.map((release) => (
          <li key={release.id} className="rounded-lg border border-line bg-raised">
            <ReleaseRow
              release={release}
              open={opened === release.id}
              onToggle={() => setOpened(opened === release.id ? null : release.id)}
            />
            {opened === release.id ? (
              <ReleaseDetail workspaceId={workspaceId} release={release} role={role} />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReleaseRow({
  release,
  open,
  onToggle,
}: {
  release: Release;
  open: boolean;
  onToggle: () => void;
}) {
  const counted = release.total - release.canceled;
  const share = counted > 0 ? Math.round((release.done / counted) * 100) : 0;
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="block w-full rounded-lg px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-content">{release.name}</span>
        <span className="text-xs text-faint">
          {whenLine(release)} · {release.done} of {counted} done
        </span>
      </span>
      <span aria-hidden="true" className="mt-2 block h-1 rounded-full bg-surface">
        <span
          className={`block h-full rounded-full ${release.shippedAt ? 'bg-muted' : 'bg-accent'}`}
          style={{ width: `${share}%` }}
        />
      </span>
    </button>
  );
}

function ReleaseIssues({
  workspaceId,
  issues,
}: {
  workspaceId: string;
  issues: readonly {
    id: string;
    key: string;
    title: string;
    status: string;
    projectName: string;
  }[];
}) {
  return (
    <ul className="space-y-1">
      {issues.map((issue) => (
        <li key={issue.id} className="flex items-baseline gap-2 text-sm">
          <Link
            href={issueHref(workspaceId, issue.id)}
            className={`min-w-0 truncate hover:underline ${
              issue.status === 'DONE' || issue.status === 'CANCELED'
                ? 'text-faint line-through'
                : 'text-content'
            }`}
          >
            <span className="mr-1.5 font-mono text-xs text-faint">{issue.key}</span>
            {issue.title}
          </Link>
          <span className="ml-auto shrink-0 text-[11px] text-faint">{issue.projectName}</span>
        </li>
      ))}
    </ul>
  );
}

function ReleaseDetail({
  workspaceId,
  release,
  role,
}: {
  workspaceId: string;
  release: Release;
  role: Role | undefined;
}) {
  const queryClient = useQueryClient();
  const me = useMyId();
  const detail = useQuery({
    queryKey: ['release', workspaceId, release.id],
    queryFn: () =>
      call(contracts['releases.get'], { params: { workspaceId, releaseId: release.id } }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: releasesKey(workspaceId) });
  const ship = useMutation({
    mutationFn: () =>
      call(contracts['releases.ship'], {
        params: { workspaceId, releaseId: release.id },
        body: {},
      }),
    onSuccess: refresh,
  });
  const takeAway = useMutation({
    mutationFn: () =>
      call(contracts['releases.remove'], { params: { workspaceId, releaseId: release.id } }),
    onSuccess: refresh,
  });
  const canShip = Boolean(role) && can(role!, 'issue:update') && !release.shippedAt;
  const mayTakeAway = Boolean(role) && (can(role!, 'project:delete') || release.createdBy === me);
  const issues = detail.data?.issues ?? [];
  const failed = ship.error ?? takeAway.error;

  return (
    <div className="space-y-3 border-t border-line px-4 py-3">
      {issues.length > 0 ? <ReleaseIssues workspaceId={workspaceId} issues={issues} /> : null}
      {detail.isSuccess && issues.length === 0 ? (
        <p className="text-xs text-faint">Nothing in it yet.</p>
      ) : null}
      {release.notes ? <ReleaseNotes notes={release.notes} /> : null}
      <div className="flex items-center justify-end gap-2">
        {failed ? (
          <p role="alert" className="mr-auto text-xs text-danger-soft">
            {(failed as Error).message}
          </p>
        ) : null}
        {mayTakeAway ? (
          <button
            type="button"
            disabled={takeAway.isPending}
            onClick={() => takeAway.mutate()}
            className="rounded-md px-2.5 py-1 text-xs text-muted hover:text-danger-soft"
          >
            Remove
          </button>
        ) : null}
        {canShip ? (
          <button
            type="button"
            disabled={ship.isPending}
            onClick={() => ship.mutate()}
            className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
          >
            Ship it
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ReleaseNotes({ notes }: { notes: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <section aria-label="Release notes" className="rounded-md border border-line bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-content">Release notes</h3>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard.writeText(notes).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
          className="rounded px-1.5 text-[11px] text-muted hover:text-content"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs text-muted">
        {notes}
      </pre>
    </section>
  );
}

function NewRelease({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [targetOn, setTargetOn] = useState('');
  const plan = useMutation({
    mutationFn: () =>
      call(contracts['releases.create'], {
        params: { workspaceId },
        body: { name: name.trim(), targetOn: targetOn || null },
      }),
    onSuccess: () => {
      setName('');
      setTargetOn('');
      return queryClient.invalidateQueries({ queryKey: releasesKey(workspaceId) });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) plan.mutate();
  }

  return (
    <form
      onSubmit={submit}
      aria-label="Plan a release"
      className="flex flex-wrap items-center gap-2"
    >
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        aria-label="Release name"
        placeholder="Version 2.0"
        maxLength={80}
        className={`${FIELD} min-w-0 flex-1`}
      />
      <input
        type="date"
        value={targetOn}
        onChange={(event) => setTargetOn(event.target.value)}
        aria-label="Aimed at"
        className={FIELD}
      />
      <button
        type="submit"
        disabled={!name.trim() || plan.isPending}
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
      >
        Plan release
      </button>
      {plan.isError ? (
        <p role="alert" className="basis-full text-xs text-danger-soft">
          {(plan.error as Error).message}
        </p>
      ) : null}
    </form>
  );
}
