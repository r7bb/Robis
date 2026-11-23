import {
  auditKeyringFromEnv,
  configureAuditKeys,
  createDatabase,
  settleAgentSteps,
  settleDeferredAccountEvents,
  WORKSPACE_EXPORT_JOB,
} from '@robis/database';
import { mailerFromEnv } from '@robis/mailer';
import { storageFromEnv } from '@robis/storage';
import { startTracingFromEnv } from '@robis/telemetry';
import { setLogService } from '@robis/telemetry/log';
import { buildApp, rateStoreFromEnv } from './app.ts';
import { startApiRunner, startAutomationRunner } from './automation/runner.ts';
import { loadEnv } from './env.ts';
import { runExportJob } from './exports/job.ts';
import { serveMetrics } from './metrics.ts';

const env = loadEnv();
// Spans to a collector when OTEL_EXPORTER_OTLP_ENDPOINT names one (A5).
const tracing = startTracingFromEnv('api');
setLogService('api');
const { db, close } = createDatabase(env.DATABASE_URL, { max: env.DB_POOL_MAX });
// The rate counts get a small pool of their own that gives up fast (A6): a
// flood of requests can fill the main pool, and the limits must still count
// (or fall back to memory) rather than queue behind it.
const rates = createDatabase(env.DATABASE_URL, { max: 4, statementTimeoutMs: 1000 });

/*
 * Mail is sent by the worker, but the API checks the same configuration and
 * refuses to start without a production driver. Accepting reset requests
 * that nothing will ever deliver, or that the console driver would print
 * into a log, is worse than not starting: the missing piece stays visible.
 */
mailerFromEnv({ ...process.env, NODE_ENV: env.NODE_ENV });

// The audit trail is signed with a key held outside the database; refuse to
// start in production without one. Chains from before signing are sealed
// once, by hand, with `bun run audit:seal` (see audit-seal.ts for why).
configureAuditKeys(auditKeyringFromEnv({ ...process.env, NODE_ENV: env.NODE_ENV }));

const app = buildApp({
  db,
  env,
  logger: env.API_LOG,
  rateLimits: { passwordForgotPerHourPerAddress: env.AUTH_FORGOT_PER_HOUR },
  rateStore: rateStoreFromEnv(env, rates.db),
});

await app.listen({ port: env.API_PORT, host: env.API_HOST });
const metricsServer = serveMetrics(app, { port: env.METRICS_PORT, hostname: env.METRICS_HOST });
// Automation rules run here, not in the worker: only the API signs the trail (B9).
const stopAutomation = startAutomationRunner(db, app.log);
// Exports run here too (C6), one at a time, against the routes' storage.
const exportStorage = storageFromEnv(env);
const stopExports = startApiRunner(
  db,
  app.log,
  'exports',
  { [WORKSPACE_EXPORT_JOB]: (payload) => runExportJob(db, exportStorage, payload) },
  1,
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    // Stop accepting connections and let in-flight requests finish before the
    // pool goes away, so a deploy doesn't turn into a burst of 500s.
    await app.close();
    metricsServer.stop();
    await stopAutomation();
    await stopExports();
    // A failed sign-in is recorded just after its reply; let those land.
    await settleDeferredAccountEvents();
    await settleAgentSteps();
    await Promise.all([close(), rates.close(), tracing.stop()]);
    process.exit(0);
  });
}
