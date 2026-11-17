import type { BULK_SKIP_REASONS } from '@robis/shared';

/**
 * What a bulk change did (C1), in plain words: how many issues changed, and
 * how many were left alone and why, so nothing is skipped silently.
 */

type Reason = (typeof BULK_SKIP_REASONS)[number];

const REASONS: Record<Reason, string> = {
  not_found: 'gone or not in this workspace',
  forbidden: 'not yours to change',
  unchanged: 'already that way',
  too_many_labels: 'at the label limit',
};

type Result = { changed: readonly string[]; skipped: readonly { id: string; reason: Reason }[] };

/** "Changed 3. Left 1: already that way." in plain words. */
export function describeResult({ changed, skipped }: Result): string {
  const done = `Changed ${changed.length} ${changed.length === 1 ? 'issue' : 'issues'}.`;
  if (skipped.length === 0) return done;
  const counts = new Map<Reason, number>();
  for (const { reason } of skipped) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const why = [...counts].map(([reason, n]) => `${n} ${REASONS[reason]}`).join(', ');
  return `${done} Left ${skipped.length}: ${why}.`;
}
