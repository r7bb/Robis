'use client';

import { useReleases } from './use-releases.ts';

/**
 * Which release an issue is part of, or none. Only releases still to ship
 * are offered; one that has shipped is shown, but not offered to others.
 */
export function ReleasePicker({
  workspaceId,
  value,
  canEdit,
  onChange,
}: {
  workspaceId: string;
  value: string | null;
  canEdit: boolean;
  onChange: (releaseId: string | null) => void;
}) {
  const releases = useReleases(workspaceId);
  const offered = (releases.data?.releases ?? []).filter(
    (release) => !release.shippedAt || release.id === value,
  );
  if (offered.length === 0) {
    return <p className="text-xs text-faint">No releases planned yet.</p>;
  }
  const current = offered.find((release) => release.id === value);
  return (
    <select
      aria-label="Release"
      value={value ?? ''}
      disabled={!canEdit || Boolean(current?.shippedAt)}
      onChange={(event) => onChange(event.target.value || null)}
      className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-content disabled:opacity-60"
    >
      <option value="">In no release</option>
      {offered.map((release) => (
        <option key={release.id} value={release.id}>
          {release.name}
          {release.shippedAt
            ? ' (shipped)'
            : release.targetOn
              ? ` (aimed at ${release.targetOn})`
              : ''}
        </option>
      ))}
    </select>
  );
}
