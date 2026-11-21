import { quantileEdge } from '@robis/database';
import { INSIGHT_MIN_SAMPLE } from '@robis/shared';

/**
 * System health (Phase 6), worded from real instruments: pure, so the
 * minimum-sample rule and the bucket quantiles are tested without a server.
 */

const MEDIAN = 0.5;
const P95 = 0.95;

export type Reading = {
  count: number;
  median: { withinMs: number | null } | null;
  p95: { withinMs: number | null } | null;
};

/** A timing's count, and its median and 95th percentile once there are enough. */
export function readingOf(counts: readonly number[]): Reading {
  const count = counts.reduce((sum, n) => sum + n, 0);
  if (count < INSIGHT_MIN_SAMPLE) return { count, median: null, p95: null };
  return {
    count,
    median: { withinMs: quantileEdge(counts, MEDIAN) },
    p95: { withinMs: quantileEdge(counts, P95) },
  };
}

export type Acceptance = { accepted: number; dismissed: number; rate: number | null };

/** How often a kind of hint was used, once enough people have answered it. */
export function acceptanceOf(accepted: number, dismissed: number): Acceptance {
  const answered = accepted + dismissed;
  return {
    accepted,
    dismissed,
    rate: answered < INSIGHT_MIN_SAMPLE ? null : accepted / answered,
  };
}
