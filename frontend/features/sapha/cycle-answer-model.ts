/** A board as a running cycle names it. */
type OnBoard = { projectName: string; projectKey: string };

/**
 * The running cycles on the board a question named: its key exactly, else
 * its name, else any board whose name holds the words. Every running cycle
 * when no board was named.
 */
export function cyclesOn<T extends OnBoard>(cycles: readonly T[], board: string | null): T[] {
  if (!board) return [...cycles];
  const wanted = board.trim().toLowerCase();
  const byKey = cycles.filter((c) => c.projectKey.toLowerCase() === wanted);
  if (byKey.length > 0) return byKey;
  const byName = cycles.filter((c) => c.projectName.toLowerCase() === wanted);
  if (byName.length > 0) return byName;
  return cycles.filter((c) => c.projectName.toLowerCase().includes(wanted));
}
