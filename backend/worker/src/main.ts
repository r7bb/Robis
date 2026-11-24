import {
  ASSIST_JOB,
  AUTOMATION_JOB,
  createDatabase,
  type EnqueueOptions,
  enqueue,
  hasPendingJob,
  listenForJobs,
  REPEATS_JOB,
  STORAGE_PURGE_JOB,
  STORY_EXPIRY_INTERVAL_MS,
  STORY_EXPIRY_JOB,
  scheduleRecurring,
  WORKSPACE_EXPORT_JOB,
} from '@robis/database';
import { mailerFromEnv } from '@robis/mailer';
import { TRIAGE_JOB } from '@robis/shared';
import { loadConfig, portFrom } from '@robis/shared/config';
import { startTracingFromEnv } from '@robis/telemetry';
import { log, setLogService } from '@robis/telemetry/log';
import { assistHandler } from './assist-job.ts';
import { auditStreamConfig, httpSink, streamAuditEvents } from './audit-stream.ts';
import { CYCLE_ENDING_JOB } from './cycle-ending.ts';
import { handlers } from './handlers.ts';
import { DEFAULT_HEARTBEAT_FILE, heartbeat } from './heartbeat.ts';
import { mailHandlers } from './mail.ts';
import { serveWorkerMetrics, workerMetrics } from './metrics.ts';
import { PICTURES_INTERVAL_MS, PICTURES_JOB, picturesHandler } from './pictures/job.ts';
import { checkVapidKeys, pushHandlers, vapidFromEnv } from './push.ts';
import { Runner } from './runner.ts';
import { SHOTS_INTERVAL_MS, SHOTS_JOB, shotsHandler } from './shots.ts';
import { storagePurgeHandler, workerStorage } from './storage-purge.ts';
import { providerAssistant, providerSummarizer } from './summary-provider.ts';
import { triageHandler } from './triage.ts';

// Before anything else, and failing closed: see `loadConfig`. The origin is
// the one every mailed link is built from.
const {
  databaseUrl: DATABASE_URL,
  webOrigin,
  metricsHost,
} = loadConfig(process.env, { webOrigin: true });
// Spans to a collector when OTEL_EXPORTER_OTLP_ENDPOINT names one (A5).
const tracing = startTracingFromEnv('worker');
setLogService('worker');

const { db, close } = createDatabase(DATABASE_URL, { max: 5 });

/** How long the worker waits, idle, when nothing wakes it (stage 3, item 26). */
const FALLBACK_POLL_MS = 30_000;

// The queue, the audit stream's lag and each job's outcome, for Prometheus
// (A5); kinds are the handlers' names, a fixed list.
const metrics = workerMetrics(db, {
  knows: (kind) => Object.hasOwn(handlers, kind),
  auditStream: auditStreamConfig(process.env) !== null,
});

const runner = new Runner({
  db,
  handlers,
  idleDelayMs: FALLBACK_POLL_MS,
  onPoll: heartbeat(process.env.WORKER_HEARTBEAT_FILE ?? DEFAULT_HEARTBEAT_FILE),
  observe: metrics.observe,
  // Automation rules run in the API, which signs the trail (B9), and so do
  // exports (C6), which read tables this role is not given, and repeating
  // issues, which the API files.
  exceptKinds: [AUTOMATION_JOB, WORKSPACE_EXPORT_JOB, REPEATS_JOB],
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
  // Once each, however often the worker restarts: see `scheduleRecurring`.
  const { dropped } = await scheduleRecurring(db, [
    { kind: 'sessions.cleanup', delayMs: HOUR_MS },
    { kind: 'nudges.scan', delayMs: NUDGE_INTERVAL_MS },
    { kind: 'agents.judge', delayMs: HOUR_MS },
    // Hourly, so the day's digests go out within the hour of DIGEST_HOUR_UTC (C3).
    { kind: 'digests.scan', delayMs: HOUR_MS },
    // Stories past their 24 hours (B2): hidden at once, deleted within this.
    { kind: STORY_EXPIRY_JOB, delayMs: STORY_EXPIRY_INTERVAL_MS },
    // Hourly, so a cycle's day-before notice goes out within the hour of nine there.
    { kind: CYCLE_ENDING_JOB, delayMs: HOUR_MS },
  ]);
  if (dropped > 0) log.info(`maintenance: dropped ${dropped} repeated waiting jobs`);
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

// Web push (C3), when keys are set. Without them nobody can subscribe (the
// API offers no key), so no push job is ever queued.
const vapid = vapidFromEnv(process.env);
if (vapid) {
  await checkVapidKeys(vapid.keys);
  Object.assign(handlers, pushHandlers(vapid));
} else log.warn('VAPID keys are not set: web push is off.');

// Files left behind by deleted issues, comments and workspaces.
handlers[STORAGE_PURGE_JOB] = storagePurgeHandler(workerStorage(process.env));

// The scripted triage agent (B5), through the MCP server. Without its
// address the jobs wait in the queue, and the log says why.
const mcpUrl = process.env.MCP_URL;
// The optional one-line summary: only with a key, and then only for
// workspaces that turned it on (they send issue text to a third party).
const summaryKey = process.env.SUMMARY_API_KEY;
const summarize = summaryKey
  ? providerSummarizer({ apiKey: summaryKey, model: process.env.SUMMARY_MODEL || undefined })
  : undefined;
// Assistance (D3): asks the API queued, answered here, the one place that
// talks to the provider; without a key each ask fails at once.
handlers[ASSIST_JOB] = assistHandler(
  summaryKey
    ? providerAssistant({ apiKey: summaryKey, model: process.env.SUMMARY_MODEL || undefined })
    : undefined,
);
if (mcpUrl) {
  handlers[TRIAGE_JOB] = triageHandler({ mcpUrl, summarize });
  // Different shots (Phase 2c): an idea a day from each workspace's chosen
  // agent. Looked for hourly, and once soon after a start, so a new day's
  // shot does not wait an hour for a restarted worker.
  handlers[SHOTS_JOB] = shotsHandler({ mcpUrl });
  reschedule(SHOTS_JOB, SHOTS_INTERVAL_MS);
  if (!(await hasPendingJob(db, SHOTS_JOB))) {
    await enqueue(db, SHOTS_JOB, {}, { delayMs: 30_000 });
  }
} else {
  log.warn('MCP_URL is not set: new issues are not triaged by an agent, and no shots are posted.');
}

// The pictures agent (Phase 2c): a credited, openly licensed picture a day
// for each workspace that chose one, posted through the API. Without the
// API's address, or with no workspace choosing it, nothing is fetched.
const apiUrl = process.env.API_URL;
if (apiUrl) {
  handlers[PICTURES_JOB] = picturesHandler({
    apiUrl,
    userAgent: process.env.PICTURES_USER_AGENT || undefined,
  });
  reschedule(PICTURES_JOB, PICTURES_INTERVAL_MS);
  if (!(await hasPendingJob(db, PICTURES_JOB))) {
    await enqueue(db, PICTURES_JOB, {}, { delayMs: 60_000 });
  }
} else {
  log.warn('API_URL is not set: the pictures agent posts nothing.');
}

reschedule('sessions.cleanup', HOUR_MS);
reschedule('nudges.scan', NUDGE_INTERVAL_MS);
reschedule('agents.judge', HOUR_MS);
reschedule('digests.scan', HOUR_MS);
reschedule(STORY_EXPIRY_JOB, STORY_EXPIRY_INTERVAL_MS);
reschedule(CYCLE_ENDING_JOB, HOUR_MS);

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
    if (delivered > 0) log.info(`audit stream: delivered ${delivered} events`);
  };
  reschedule('audit.stream', auditStream.intervalMs, { maxAttempts: STREAM_MAX_ATTEMPTS });

  // One chain, however many times the worker restarts.
  if (!(await hasPendingJob(db, 'audit.stream'))) {
    await enqueue(db, 'audit.stream', {}, { maxAttempts: STREAM_MAX_ATTEMPTS });
  }
  log.info(`Audit stream on, to ${auditStream.url.origin}`);
}

// Woken as each job is queued, rather than polling every second. Opened
// last, after every configuration check, so a misconfigured worker refuses
// with its reason rather than failing to reach the database first.
const jobsListener = await listenForJobs(DATABASE_URL, () => runner.wake());

// Not on any public port: inside the network, for Prometheus to scrape.
const metricsServer = serveWorkerMetrics(metrics, {
  port: portFrom(process.env, 'WORKER_METRICS_PORT', 9467),
  hostname: metricsHost,
});

log.info(`Worker ${runner.id} waiting for jobs (woken on each, polling every 30 s)`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    // Stop claiming, let the in-flight batch finish, then release the pool.
    // Anything still claimed is reclaimed by another worker after the
    // visibility timeout.
    runner.stop();
    metricsServer.stop();
    await jobsListener.close();
    await close();
    await tracing.stop();
    process.exit(0);
  });
}

await runner.start();
