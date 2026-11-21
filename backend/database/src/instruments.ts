import { INSTRUMENT_BOUNDS_MS, type Instrument } from '@robis/shared';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { Executor } from './index.ts';
import { instrumentReadings } from './schema.ts';

/**
 * Timings the services record as they work, for system health (Phase 6).
 *
 * Each process counts its timings into fixed buckets per minute and writes
 * them once a minute. Counts add, so readings from every instance, and a
 * minute written twice, merge by addition; a quantile is then known to
 * within a bucket, and is given as that bucket's upper edge.
 */

/** One bucket per edge, and one more for anything beyond the last. */
export const BUCKETS = INSTRUMENT_BOUNDS_MS.length + 1;

const MINUTE_MS = 60_000;
/** A failed write keeps its minutes for the next try, up to an hour of them. */
export const KEPT_MINUTES = 60;

/** The bucket a timing falls in: the first edge at or above it. */
export function bucketOf(ms: number): number {
  const index = INSTRUMENT_BOUNDS_MS.findIndex((edge) => ms <= edge);
  return index === -1 ? INSTRUMENT_BOUNDS_MS.length : index;
}

/** Bucket counts added together, element by element. */
export function addCounts(a: readonly number[], b: readonly number[]): number[] {
  return Array.from({ length: BUCKETS }, (_, i) => (a[i] ?? 0) + (b[i] ?? 0));
}

/**
 * The q-th quantile's bucket edge, by nearest rank: the edge below which at
 * least q of the timings fall. Null when that is beyond the last edge.
 */
export function quantileEdge(counts: readonly number[], q: number): number | null {
  const total = counts.reduce((sum, n) => sum + n, 0);
  if (total === 0) throw new RangeError('quantile of nothing');
  const rank = Math.max(1, Math.ceil(q * total));
  let seen = 0;
  for (const [i, n] of counts.entries()) {
    seen += n;
    if (seen >= rank) return INSTRUMENT_BOUNDS_MS[i] ?? null;
  }
  return null;
}

type Logger = { warn: (fields: object, message: string) => void };

/**
 * One process's timings for one instrument, held per minute until written.
 * `start` writes every interval; `stop` writes what is left.
 */
export class InstrumentRecorder {
  private pending = new Map<number, number[]>();
  private timer: ReturnType<typeof setInterval> | null = null;
  /** The write under way, so a stop waits for it rather than racing it. */
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: Executor,
    readonly instrument: Instrument,
    private readonly source: string,
    private readonly log: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  record(ms: number) {
    if (!Number.isFinite(ms)) return;
    const minute = Math.floor(this.now() / MINUTE_MS) * MINUTE_MS;
    const counts = this.pending.get(minute) ?? new Array<number>(BUCKETS).fill(0);
    const bucket = bucketOf(Math.max(0, ms));
    this.pending.set(
      minute,
      counts.map((n, i) => (i === bucket ? n + 1 : n)),
    );
  }

  /**
   * Write what is held, after any write already under way. On failure the
   * minutes are kept for the next try.
   */
  flush(): Promise<void> {
    this.writing = this.writing.then(() => this.write());
    return this.writing;
  }

  private async write(): Promise<void> {
    if (this.pending.size === 0) return;
    const taken = this.pending;
    this.pending = new Map();
    try {
      await writeReadings(
        this.db,
        [...taken].map(([minute, counts]) => ({
          instrument: this.instrument,
          source: this.source,
          minute: new Date(minute),
          counts,
        })),
      );
    } catch (error) {
      this.log.warn({ err: error, instrument: this.instrument }, 'timings could not be written');
      this.keep(taken);
    }
  }

  /** Put minutes back after a failed write, dropping the oldest past an hour. */
  private keep(taken: Map<number, number[]>) {
    const merged = new Map(taken);
    for (const [minute, counts] of this.pending) {
      merged.set(minute, addCounts(merged.get(minute) ?? [], counts));
    }
    const newest = [...merged.keys()].sort((a, b) => b - a).slice(0, KEPT_MINUTES);
    this.pending = new Map(newest.map((minute) => [minute, merged.get(minute)!]));
  }

  start(intervalMs = MINUTE_MS) {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), intervalMs);
    this.timer.unref?.();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }
}

type Reading = { instrument: Instrument; source: string; minute: Date; counts: number[] };

/** Add readings to what is stored for their minute, bucket by bucket. */
export async function writeReadings(db: Executor, readings: readonly Reading[]): Promise<void> {
  if (readings.length === 0) return;
  await db
    .insert(instrumentReadings)
    .values([...readings])
    .onConflictDoUpdate({
      target: [instrumentReadings.instrument, instrumentReadings.minute, instrumentReadings.source],
      set: {
        counts: sql`array(select a + b from unnest(${instrumentReadings.counts}, excluded.counts) with ordinality as t(a, b, i) order by i)`,
      },
    });
}

/** Every instance's counts for an instrument since a moment, added up. */
export async function readInstrument(
  db: Executor,
  instrument: Instrument,
  since: Date,
): Promise<number[]> {
  const rows = await db
    .select({ counts: instrumentReadings.counts })
    .from(instrumentReadings)
    .where(
      and(eq(instrumentReadings.instrument, instrument), gte(instrumentReadings.minute, since)),
    );
  return rows.reduce<number[]>(
    (sum, row) => addCounts(sum, row.counts),
    new Array<number>(BUCKETS).fill(0),
  );
}

/** A week of minutes is kept: enough to look back past a weekend. */
export const READINGS_KEPT_DAYS = 7;

/** Remove readings past the week they are kept for (the worker's hourly cleanup). */
export function pruneReadings(db: Executor, now = new Date()): Promise<number> {
  return sweepReadings(db, new Date(now.getTime() - READINGS_KEPT_DAYS * 24 * 60 * MINUTE_MS));
}

/** Remove readings older than a moment; the count removed. */
export async function sweepReadings(db: Executor, before: Date): Promise<number> {
  const removed = await db
    .delete(instrumentReadings)
    .where(lt(instrumentReadings.minute, before))
    .returning({ minute: instrumentReadings.minute });
  return removed.length;
}
