import type { Cycle } from './use-cycles.ts';

/** Issues in a cycle that are neither done nor canceled. */
const unfinishedOf = (cycle: Cycle) => cycle.total - cycle.done - cycle.canceled;

/**
 * The most recent cycle that ended before `today` with issues still open,
 * and the cycle they could move on to: the one running, else the next.
 * None when nothing is left over, or there is nowhere to move it.
 */
export function leftOver(
  cycles: readonly Cycle[],
  today: string,
): { from: Cycle; to: Cycle; unfinished: number } | null {
  const ended = cycles.filter((c) => c.endsOn < today);
  const from = ended[ended.length - 1];
  const to = cycles.find((c) => c.endsOn >= today);
  if (!from || !to) return null;
  const unfinished = unfinishedOf(from);
  return unfinished > 0 ? { from, to, unfinished } : null;
}
