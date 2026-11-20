import { createHash } from 'node:crypto';
import type { Executor } from '@robis/database';
import { log } from '@robis/telemetry/log';
import { sql } from 'drizzle-orm';

/**
 * Where rate counts live (A6).
 *
 * A count per key, started afresh once its window is over. Two drivers
 * behind one interface: memory, for tests and a single instance in
 * development, and Postgres, so several API instances share one budget
 * instead of each allowing the whole of it. Postgres rather than another
 * service: the counts are one upsert per hit on an unlogged table (no
 * write-ahead log, emptied by a crash, which only forgives a few counts).
 * In production the Postgres store has a memory store behind it, so a
 * database that is slow or down loosens the limits to per instance rather
 * than switching them off (`withBackstop`).
 */

export type Hit = {
  count: number;
  /** When this window's first hit came, in ms since 1970, on the store's clock. */
  firstAt: number;
  /** When the latest hit came. */
  lastAt: number;
  /** When the count is forgotten. */
  resetAt: number;
  /**
   * The store's clock as it counted: waits are judged against this rather
   * than the instance's own clock, which may not agree with the database's.
   */
  now: number;
  /**
   * The count as it stood before this hit, or null when this hit started a
   * fresh window: so a caller can decide on the count before, atomically
   * with counting, rather than look first and count after.
   */
  previous: { count: number; lastAt: number } | null;
};

export type HitOptions = {
  /**
   * Push the end of the window out with every hit, so a count runs on while
   * hits keep coming. Otherwise the window is fixed from its first hit.
   */
  sliding?: boolean;
  /**
   * Count inside this transaction, on its connection, rather than take
   * another from the pool while holding one: a caller already in a
   * transaction would otherwise wait on the pool it is filling.
   */
  within?: Executor;
};

export interface RateStore {
  /** One more on the key's count, and the count as it now stands. */
  hit(key: string, windowMs: number, options?: HitOptions): Promise<Hit>;
  /** The key's count without adding to it, or null when there is none. */
  peek(key: string): Promise<Hit | null>;
  /** Forget every key that starts with `prefix`, in whole `|` parts. */
  clearPrefix(prefix: string): Promise<void>;
  /**
   * Take `hit` back, restoring the count before it, but only if nothing
   * else has counted since: a refused try that should not count, which a
   * burst of tries cannot use to slip through.
   */
  takeBack(key: string, hit: Hit, windowMs: number, options?: HitOptions): Promise<void>;
}

/**
 * Whether `prefix` is whole parts of `key`, as the Postgres store matches
 * hashed parts: `a:sam` is a prefix of `a:sam` and `a:sam|x`, not `a:samuel`.
 */
function wholePartsOf(key: string, prefix: string): boolean {
  if (prefix.endsWith('|')) return key.startsWith(prefix);
  return key === prefix || key.startsWith(`${prefix}|`);
}

/** Counts kept at most in memory; past this the oldest go first. */
const MAX_MEMORY_ENTRIES = 100_000;
const SWEEP_INTERVAL_MS = 60_000;
/** Expired rows deleted per statement, so a sweep never holds the table long. */
const SWEEP_BATCH = 5_000;

/**
 * In process memory: each instance keeps its own counts, so behind N
 * instances a limit is N times as loose. Swept and capped, oldest first, so
 * a caller rotating addresses cannot grow it without bound; a count under
 * attack is refreshed by every hit and so is never the oldest.
 */
export function memoryRateStore({
  now: clock = Date.now,
}: {
  /** The clock, for tests that step through windows without waiting. */
  now?: () => number;
} = {}): RateStore & { clear(): void } {
  const counts = new Map<string, Hit>();
  let lastSweep = clock();

  function sweep(now: number) {
    if (now - lastSweep < SWEEP_INTERVAL_MS) return;
    lastSweep = now;
    for (const [key, entry] of counts) if (entry.resetAt <= now) counts.delete(key);
  }

  return {
    async hit(key, windowMs, { sliding = false } = {}) {
      const now = clock();
      sweep(now);
      const current = counts.get(key);
      const live = current && current.resetAt > now ? current : undefined;
      const next: Hit = {
        count: (live?.count ?? 0) + 1,
        firstAt: live?.firstAt ?? now,
        lastAt: now,
        resetAt: live && !sliding ? live.resetAt : now + windowMs,
        now,
        previous: live ? { count: live.count, lastAt: live.lastAt } : null,
      };
      // Deleted first, so the map stays oldest first for the cap.
      counts.delete(key);
      counts.set(key, next);
      if (counts.size > MAX_MEMORY_ENTRIES) {
        const oldest = counts.keys().next().value;
        if (oldest !== undefined) counts.delete(oldest);
      }
      return next;
    },
    async peek(key) {
      const now = clock();
      const current = counts.get(key);
      return current && current.resetAt > now ? { ...current, now } : null;
    },
    async clearPrefix(prefix) {
      for (const key of counts.keys()) if (wholePartsOf(key, prefix)) counts.delete(key);
    },
    async takeBack(key, hit, windowMs, { sliding = false } = {}) {
      const current = counts.get(key);
      if (!current || current.count !== hit.count || !hit.previous) return;
      counts.set(key, {
        ...current,
        count: hit.previous.count,
        lastAt: hit.previous.lastAt,
        resetAt: sliding ? hit.previous.lastAt + windowMs : current.resetAt,
      });
    },
    clear() {
      counts.clear();
      lastSweep = clock();
    },
  };
}

type Row = {
  count: number;
  first_at: number;
  last_at: number;
  reset_at: number;
  now: number;
  previous_count?: number | null;
  previous_at?: number | null;
};

const asHit = (row: Row): Hit => ({
  count: Number(row.count),
  firstAt: Number(row.first_at),
  lastAt: Number(row.last_at),
  resetAt: Number(row.reset_at),
  now: Number(row.now),
  previous:
    row.previous_count === null || row.previous_count === undefined
      ? null
      : { count: Number(row.previous_count), lastAt: Number(row.previous_at) },
});

const digest = (part: string) => createHash('sha256').update(part).digest('hex').slice(0, 32);

/**
 * A key as the table keeps it: the limiter's name, then each `|`-separated
 * part hashed, so no address, email or account id sits there in plain
 * text, while a prefix of whole parts still finds its keys. Not secret: a
 * reader of the database could confirm a guessed address, as with the rest
 * of the database; it keeps them from being read off.
 */
export function storedKey(key: string): string {
  const colon = key.indexOf(':');
  const name = key.slice(0, colon + 1);
  return (
    name +
    key
      .slice(colon + 1)
      .split('|')
      .map(digest)
      .join('|')
  );
}

/** A prefix as `storedKey` would write it: whole parts, the last ending in `|`. */
function storedPrefix(prefix: string): string {
  return prefix.endsWith('|') ? `${storedKey(prefix.slice(0, -1))}|` : storedKey(prefix);
}

const ms = (column: string) => sql.raw(`(extract(epoch from ${column}) * 1000)::float8`);

/**
 * In Postgres: one atomic upsert per hit, timed by the database's clock so
 * every instance agrees on when a window ends, returning the row as it was
 * before (`RETURNING old`, Postgres 18, which every environment here runs).
 * Expired rows are swept at most once a minute per instance, in batches and
 * off the request's path.
 */
export function postgresRateStore(db: Executor): RateStore {
  let lastSweep = 0;

  async function sweepBatches() {
    for (;;) {
      const gone = (await db.execute(sql`
        delete from rate_limits where key in (
          select key from rate_limits where reset_at <= now() limit ${SWEEP_BATCH}
        ) returning 1 as one
      `)) as unknown as unknown[];
      if (gone.length < SWEEP_BATCH) return;
    }
  }

  function sweep() {
    const now = Date.now();
    if (now - lastSweep < SWEEP_INTERVAL_MS) return;
    lastSweep = now;
    // Not awaited: a sweep is housekeeping, never a reason to hold a request.
    sweepBatches().catch((error: unknown) =>
      log.warn(`rate limits: sweep failed: ${(error as Error).message}`),
    );
  }

  return {
    async hit(key, windowMs, { sliding = false, within = db } = {}) {
      sweep();
      const window = sql`now() + ${Math.round(windowMs)} * interval '1 millisecond'`;
      const rows = (await within.execute(sql`
        insert into rate_limits as r (key, count, first_at, last_at, reset_at)
        values (${storedKey(key)}, 1, now(), now(), ${window})
        on conflict (key) do update set
          count = case when r.reset_at <= now() then 1 else r.count + 1 end,
          first_at = case when r.reset_at <= now() then now() else r.first_at end,
          last_at = now(),
          reset_at = case when r.reset_at <= now() or ${sliding} then excluded.reset_at else r.reset_at end
        returning new.count, ${ms('new.first_at')} as first_at, ${ms('new.last_at')} as last_at,
          ${ms('new.reset_at')} as reset_at, ${ms('now()')} as now,
          case when old.reset_at > now() then old.count end as previous_count,
          case when old.reset_at > now() then ${ms('old.last_at')} end as previous_at
      `)) as unknown as Row[];
      return asHit(rows[0]!);
    },
    async peek(key) {
      const rows = (await db.execute(sql`
        select count, ${ms('first_at')} as first_at, ${ms('last_at')} as last_at,
          ${ms('reset_at')} as reset_at, ${ms('now()')} as now
        from rate_limits where key = ${storedKey(key)} and reset_at > now()
      `)) as unknown as Row[];
      return rows[0] ? asHit(rows[0]) : null;
    },
    async clearPrefix(prefix) {
      await db.execute(
        sql`delete from rate_limits where starts_with(key, ${storedPrefix(prefix)})`,
      );
    },
    async takeBack(key, hit, windowMs, { sliding = false, within = db } = {}) {
      if (!hit.previous) return;
      const at = sql`to_timestamp(${hit.previous.lastAt} / 1000.0)`;
      await within.execute(sql`
        update rate_limits set
          count = ${hit.previous.count},
          last_at = ${at},
          reset_at = case when ${sliding}
            then ${at} + ${Math.round(windowMs)} * interval '1 millisecond'
            else reset_at end
        where key = ${storedKey(key)} and count = ${hit.count}
      `);
    },
  };
}

/** Warn at most this often while the shared store is failing, not once per request. */
const BACKSTOP_WARN_MS = 60_000;

/**
 * The shared store, with a memory store behind it: whatever the shared one
 * cannot answer, the memory one counts instead, so a database that is slow
 * or down (or a pool an attacker has filled) loosens the limits to per
 * instance rather than turning them off. A caller counting inside its own
 * transaction is not caught: that transaction has failed with it.
 */
export function withBackstop(
  shared: RateStore,
  backstop: RateStore,
  warn: (message: string) => void = (message) => log.warn(message),
): RateStore {
  let lastWarned = 0;
  function fallback<T>(action: string, run: (store: RateStore) => Promise<T>) {
    return run(shared).catch((error: unknown) => {
      const now = Date.now();
      if (now - lastWarned >= BACKSTOP_WARN_MS) {
        lastWarned = now;
        warn(
          `rate limits: shared store failed on ${action}, counting in memory: ${(error as Error).message}`,
        );
      }
      return run(backstop);
    });
  }
  return {
    hit: (key, windowMs, options = {}) =>
      options.within
        ? shared.hit(key, windowMs, options)
        : fallback('hit', (store) => store.hit(key, windowMs, options)),
    peek: (key) => fallback('peek', (store) => store.peek(key)),
    clearPrefix: async (prefix) => {
      // Both: a count may have landed in either.
      await Promise.all([
        shared.clearPrefix(prefix).catch(() => undefined),
        backstop.clearPrefix(prefix),
      ]);
    },
    takeBack: (key, hit, windowMs, options = {}) =>
      options.within
        ? shared.takeBack(key, hit, windowMs, options)
        : fallback('takeBack', (store) => store.takeBack(key, hit, windowMs, options)),
  };
}
