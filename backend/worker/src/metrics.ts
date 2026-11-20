import { auditStreamLag, type Database, queueStats } from '@robis/database';
import { Registry } from '@robis/metrics';
import { log } from '@robis/telemetry/log';

/**
 * The worker's metrics (A5), on a port of its own inside the network, as
 * the API's and the gateway's are: the queue read at scrape time (jobs due
 * and waiting, how long the oldest has waited, dead letters), the audit
 * stream's lag when it is on, and each job's outcome and duration by kind.
 * Kinds are the fixed list of handlers; anything else is `unknown`.
 */

const OUTCOMES = ['completed', 'retrying', 'dead'] as const;

export function workerMetrics(
  db: Database,
  options: { knows: (kind: string) => boolean; auditStream: boolean },
) {
  const registry = new Registry();
  const due = registry.gauge('robis_jobs_due', 'Jobs due now and not yet taken by a worker.');
  const oldest = registry.gauge(
    'robis_jobs_oldest_due_age_seconds',
    'How long the oldest job due and not yet taken has been waiting, in seconds.',
  );
  const dead = registry.gauge('robis_jobs_dead_letters', 'Jobs that used up their attempts.');
  const lag = options.auditStream
    ? registry.gauge(
        'robis_audit_stream_lag_events',
        'Audit events recorded but not yet acknowledged by the stream receiver.',
      )
    : null;
  const finished = registry.counter(
    'robis_jobs_total',
    'Jobs run, by kind and outcome (completed, retrying, dead).',
    ['kind', 'outcome'],
  );
  const duration = registry.histogram(
    'robis_job_duration_seconds',
    'How long a job took to run, in seconds.',
    ['kind'],
  );
  const scrapeOk = registry.gauge(
    'robis_worker_queue_readable',
    '1 when the last scrape could read the queue, 0 when it could not.',
  );

  /** Read the queue (and the stream's lag) now, for a scrape. */
  async function refresh(): Promise<void> {
    try {
      const stats = await queueStats(db);
      due.set({}, stats.due);
      oldest.set({}, stats.oldestDueSeconds);
      dead.set({}, stats.dead);
      if (lag) lag.set({}, await auditStreamLag(db));
      scrapeOk.set({}, 1);
    } catch (error) {
      scrapeOk.set({}, 0);
      log.warn('metrics: the queue could not be read', { err: error });
    }
  }

  function observe(kind: string, outcome: (typeof OUTCOMES)[number], seconds: number): void {
    const known = options.knows(kind) ? kind : 'unknown';
    finished.inc({ kind: known, outcome });
    duration.observe({ kind: known }, seconds);
  }

  return { registry, refresh, observe };
}

/** Serve `/metrics`, read fresh on each scrape. */
export function serveWorkerMetrics(
  metrics: ReturnType<typeof workerMetrics>,
  { port, hostname }: { port: number; hostname: string },
) {
  return Bun.serve({
    port,
    hostname,
    fetch: async (request) => {
      if (new URL(request.url).pathname !== '/metrics') {
        return new Response('Not found', { status: 404 });
      }
      await metrics.refresh();
      return new Response(metrics.registry.render(), {
        headers: { 'content-type': Registry.CONTENT_TYPE },
      });
    },
  });
}
