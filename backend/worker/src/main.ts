import { createDatabase, type EnqueueOptions, enqueue, hasPendingJob } from '@robis/database';
import { auditStreamConfig, httpSink, streamAuditEvents } from './audit-stream.ts';
import { handlers } from './handlers.ts';
import { Runner } from './runner.ts';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required');

const { db, close } = createDatabase(DATABASE_URL, { max: 5 });

const runner = new Runner({ db, handlers });

/**
 * Recurring maintenance.
 *
 * Scheduled by re-enqueueing with a delay rather than by a cron process: one
 * fewer moving part, and the schedule lives with the code that needs it. The
 * cost is that a job lost to a dead-letter takes its schedule with it, which is
 * why `sessions.cleanup` is harmless to miss.
 */
const HOUR_MS = 60 * 60 * 1000;

/**
 * How often to look for people worth nudging. Frequent enough that a new
 * account gets a prompt the same session, rare enough that the weekly dedupe
 * bucket does the real rate limiting.
 */
const NUDGE_INTERVAL_MS = Number(process.env.NUDGE_INTERVAL_MS ?? 15 * 60 * 1000);

async function scheduleMaintenance() {
  await enqueue(db, 'sessions.cleanup', {}, { delayMs: HOUR_MS });
  await enqueue(db, 'nudges.scan', {}, { delayMs: NUDGE_INTERVAL_MS });
}

// Recurring jobs re-enqueue themselves after running, which keeps the schedule
// next to the work instead of in a separate cron process.
const reschedule = <T extends keyof typeof handlers>(
  kind: T,
  delayMs: number,
  options: EnqueueOptions = {},
) => {
  const original = handlers[kind]!;

  handlers[kind] = async (payload, context) => {
    await original(payload, context);
    await enqueue(context.db, kind, {}, { ...options, delayMs });
  };
};

reschedule('sessions.cleanup', HOUR_MS);
reschedule('nudges.scan', NUDGE_INTERVAL_MS);

await scheduleMaintenance();

/*
 * The SIEM stream, when a receiver is configured.
 *
 * A failed delivery throws, and the queue retries it with backoff (capped at
 * an hour). The attempt budget is large on purpose: a receiver that is down
 * for an afternoon must delay the stream, not end it, because a stream job
 * that dead-letters takes its schedule with it.
 */
const STREAM_MAX_ATTEMPTS = 200;
const auditStream = auditStreamConfig(process.env);

if (auditStream) {
  const sink = httpSink(auditStream);

  handlers['audit.stream'] = async (_payload, context) => {
    const { delivered } = await streamAuditEvents(context.db, sink);
    if (delivered > 0) console.log(`audit stream: delivered ${delivered} events`);
  };
  reschedule('audit.stream', auditStream.intervalMs, { maxAttempts: STREAM_MAX_ATTEMPTS });

  // One chain, however many times the worker restarts.
  if (!(await hasPendingJob(db, 'audit.stream'))) {
    await enqueue(db, 'audit.stream', {}, { maxAttempts: STREAM_MAX_ATTEMPTS });
  }
  console.log(`Audit stream on, to ${auditStream.url.origin}`);
}

console.log(`Worker ${runner.id} polling for jobs`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    // Stop claiming, let the in-flight batch finish, then release the pool.
    // Anything still claimed is reclaimed by another worker after the
    // visibility timeout.
    runner.stop();
    await close();
    process.exit(0);
  });
}

await runner.start();
