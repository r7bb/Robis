import { type Database, InstrumentRecorder } from '@robis/database';
import { QUEUED_FOR_HEADER } from '@robis/shared';
import type { FastifyInstance } from 'fastify';
import type { ApiMetrics } from '../metrics.ts';

/**
 * Sync lag (Phase 6): how long a change waited in a browser's offline queue
 * before the server accepted it.
 *
 * The browser measures it on its own clock, so the two clocks never have to
 * agree, and sends it with the write it replays. It is the browser's word,
 * so it is bounded: only accepted writes by someone signed in count, never a
 * replay of one already answered, and at most PER_PERSON_PER_MINUTE timings
 * from one person a minute. One person can still nudge the figure within
 * that; nothing about who sent it is kept.
 */

/** A week: longer than any change sensibly waits, and the most counted. */
export const QUEUED_FOR_MAX_MS = 7 * 24 * 60 * 60 * 1000;

/** A queue draining after a day offline sends a burst; more than this from one person is noise. */
export const PER_PERSON_PER_MINUTE = 30;

const MINUTE_MS = 60_000;
const WRITES: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DIGITS = /^\d{1,10}$/;

/** The header's milliseconds, or null for anything that is not a sane count. */
export function queuedForOf(header: string | string[] | undefined): number | null {
  if (typeof header !== 'string' || !DIGITS.test(header)) return null;
  const ms = Number(header);
  return ms <= QUEUED_FOR_MAX_MS ? ms : null;
}

/**
 * Count the lag of every accepted write that reports one, into the metrics
 * and, a minute at a time, into the database for the Insights page.
 */
export function registerSyncLag(
  app: FastifyInstance,
  { db, metrics, source }: { db: Database; metrics: ApiMetrics; source: string },
) {
  const recorder = new InstrumentRecorder(db, 'sync_lag', source, {
    warn: (fields, message) => app.log.warn(fields, message),
  });
  recorder.start();

  // Timings counted this minute per person; started afresh each minute, so it
  // holds at most the people who wrote in one minute.
  let minute = 0;
  let counted = new Map<string, number>();
  const withinAllowance = (userId: string) => {
    const now = Math.floor(Date.now() / MINUTE_MS);
    if (now !== minute) {
      minute = now;
      counted = new Map();
    }
    const n = counted.get(userId) ?? 0;
    if (n >= PER_PERSON_PER_MINUTE) return false;
    counted.set(userId, n + 1);
    return true;
  };

  app.addHook('onResponse', async (request, reply) => {
    if (!WRITES.has(request.method) || reply.statusCode >= 300) return;
    if (!request.user || reply.getHeader('idempotent-replay') === 'true') return;
    const ms = queuedForOf(request.headers[QUEUED_FOR_HEADER]);
    if (ms === null || !withinAllowance(request.user.id)) return;
    metrics.syncLag.observe({}, ms / 1000);
    recorder.record(ms);
  });

  app.addHook('onClose', async () => {
    await recorder.stop();
  });

  app.decorate('syncLag', recorder);
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Sync lag's timings, for a test to write out without waiting a minute. */
    syncLag: InstrumentRecorder;
  }
}
