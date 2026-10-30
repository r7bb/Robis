import {
  createDatabase,
  type EnqueueOptions,
  enqueue,
  hasPendingJob,
  listenForJobs,
  STORAGE_PURGE_JOB,
} from '@robis/database';
import { mailerFromEnv } from '@robis/mailer';
import { loadConfig } from '@robis/shared/config';
import { auditStreamConfig, httpSink, streamAuditEvents } from './audit-stream.ts';
import { handlers } from './handlers.ts';
import { DEFAULT_HEARTBEAT_FILE, heartbeat } from './heartbeat.ts';
import { mailHandlers } from './mail.ts';
import { Runner } from './runner.ts';
import { storagePurgeHandler, workerStorage } from './storage-purge.ts';

// Before anything else, and failing closed: see `loadConfig`. The origin is
// the one every mailed link is built from.
const { databaseUrl: DATABASE_URL, webOrigin } = loadConfig(process.env, { webOrigin: true });

const { db, close } = createDatabase(DATABASE_URL, { max: 5 });

/** How long the worker waits, idle, when nothing wakes it (stage 3, item 26). */
const FALLBACK_POLL_MS = 30_000;

const runner = new Runner({
  db,
  handlers,
  idleDelayMs: FALLBACK_POLL_MS,
  onPoll: heartbeat(process.env.WORKER_HEARTBEAT_FILE ?? DEFAULT_HEARTBEAT_FILE),
});

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
const NUDGE_INTERVAL_MS = positiveMs(process.env.NUDGE_INTERVAL_MS, 15 * 60 * 1000);

/** A duration from the environment, checked now: NaN would schedule nothing. */
function positiveMs(raw: string | undefined, fallback: number): number {
  const value = raw?.trim() ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`NUDGE_INTERVAL_MS must be a whole number of milliseconds; got "${raw}".`);
  }
  return value;
}

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

/*
 * Account mail. The driver comes from the same variables the API checks,
 * and links are built from WEB_ORIGIN, never from anything a request sent.
 * In production with no SMTP configured this throws, and the worker refuses
 * to start rather than quietly print reset links into its log.
 */
Object.assign(handlers, mailHandlers({ mailer: mailerFromEnv(process.env), webOrigin }));

// Files left behind by deleted issues, comments and workspaces.
handlers[STORAGE_PURGE_JOB] = storagePurgeHandler(workerStorage(process.env));

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

// Woken as each job is queued, rather than polling every second. Opened
// last, after every configuration check, so a misconfigured worker refuses
// with its reason rather than failing to reach the database first.
const jobsListener = await listenForJobs(DATABASE_URL, () => runner.wake());

console.log(`Worker ${runner.id} waiting for jobs (woken on each, polling every 30 s)`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    // Stop claiming, let the in-flight batch finish, then release the pool.
    // Anything still claimed is reclaimed by another worker after the
    // visibility timeout.
    runner.stop();
    await jobsListener.close();
    await close();
    process.exit(0);
  });
}

await runner.start();
