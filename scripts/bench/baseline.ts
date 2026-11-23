/**
 * The load test's baseline in CI (E2): `record` adds a run's p99s to the
 * history (the last three runs on main), `compare` checks a run against
 * that history. CI runners are noisy, so the allowed margin comes from
 * the three runs themselves: twice their spread around the median, and
 * never less than half the median. Fewer than three runs: report only.
 *
 *   bun scripts/bench/baseline.ts record  result.json history.json
 *   bun scripts/bench/baseline.ts compare result.json history.json
 */

const RUNS_KEPT = 3;
const MIN_MARGIN = 0.5;
const SPREAD_TIMES = 2;
const FIGURES = ['read', 'write', 'fanout'] as const;

type Run = Record<(typeof FIGURES)[number], number | null> & { errors: number };

const read = async <T>(path: string, fallback: T): Promise<T> => {
  const file = Bun.file(path);
  return (await file.exists()) ? ((await file.json()) as T) : fallback;
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

/** The highest p99 a figure may reach: the median plus the margin. */
export function ceilingOf(values: readonly number[]): number {
  const middle = median([...values]);
  const spread = (Math.max(...values) - Math.min(...values)) / middle;
  return middle * (1 + Math.max(MIN_MARGIN, spread * SPREAD_TIMES));
}

async function main() {
  const [mode, resultPath, historyPath] = process.argv.slice(2);
  if (!mode || !resultPath || !historyPath)
    throw new Error('usage: record|compare result.json history.json');
  const run = await read<Run | null>(resultPath, null);
  if (!run) throw new Error(`no result at ${resultPath}`);
  const history = await read<Run[]>(historyPath, []);

  if (mode === 'record') {
    await Bun.write(historyPath, JSON.stringify([...history, run].slice(-RUNS_KEPT)));
    console.log(`Recorded; the baseline holds ${Math.min(history.length + 1, RUNS_KEPT)} run(s).`);
    return;
  }
  if (run.errors > 0) {
    console.error(`The load test saw ${run.errors} error(s).`);
    process.exit(1);
  }
  if (history.length < RUNS_KEPT) {
    console.log(`Only ${history.length} baseline run(s) so far; reporting, not judging.`);
    return;
  }
  let failed = false;
  for (const figure of FIGURES) {
    const values = history.map((r) => r[figure]).filter((v): v is number => v !== null);
    const now = run[figure];
    if (values.length < RUNS_KEPT || now === null) continue;
    const ceiling = ceilingOf(values);
    const ok = now <= ceiling;
    failed ||= !ok;
    console.log(
      `${ok ? 'ok ' : 'NOT'} ${figure} p99 ${now.toFixed(1)} ms (ceiling ${ceiling.toFixed(1)} ms, baseline ${values.map((v) => v.toFixed(1)).join(', ')})`,
    );
  }
  if (failed) process.exit(1);
}

if (import.meta.main) await main();
