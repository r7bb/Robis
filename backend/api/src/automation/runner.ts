import {
  AUTOMATION_JOB,
  type AutomationJob,
  claimJobs,
  completeJob,
  type Database,
  failJob,
} from '@robis/database';
import { evaluateAutomation } from './evaluate.ts';

/**
 * The API's own job runners (B9). Automation jobs run here because only the
 * API signs the audit trail and holds the write paths a rule's action goes
 * through; workspace exports (C6) because they read tables the worker's
 * role is not given. The worker leaves these kinds and these loops take
 * them. Each kind set gets a loop of its own, so a long export never holds
 * a rule up past its lock. Jobs are claimed with SKIP LOCKED, so several
 * API instances share them safely.
 */

export type ApiJobHandler = (payload: unknown) => Promise<void>;

/** A rule fires within a second or two of the change that set it off. */
const POLL_MS = 1_000;
const BATCH = 10;

type Logger = { error: (fields: object, message: string) => void };

/** One pass: claim up to `batch` jobs of the handled kinds, run them, say how many ran. */
export async function runApiJobs(
  db: Database,
  workerId: string,
  log: Logger,
  handlers: Readonly<Record<string, ApiJobHandler>>,
  batch = BATCH,
): Promise<number> {
  const claimed = await claimJobs(db, workerId, batch, new Date(), Object.keys(handlers));
  for (const job of claimed) {
    try {
      await handlers[job.kind]!(job.payload);
      await completeJob(db, job.id);
    } catch (error) {
      log.error({ err: error, jobId: job.id, kind: job.kind }, 'API job failed');
      await failJob(db, job, error);
    }
  }
  return claimed.length;
}

const automationHandlers = (db: Database) => ({
  [AUTOMATION_JOB]: (payload: unknown) => evaluateAutomation(db, payload as AutomationJob),
});

/** One pass of automation jobs alone. */
export function runAutomationJobs(db: Database, workerId: string, log: Logger) {
  return runApiJobs(db, workerId, log, automationHandlers(db));
}

/** Poll until stopped; `stop` resolves once the pass under way has finished. */
export function startApiRunner(
  db: Database,
  log: Logger,
  name: string,
  handlers: Readonly<Record<string, ApiJobHandler>>,
  batch = BATCH,
) {
  const workerId = `api-${name}-${crypto.randomUUID()}`;
  let running = true;
  let pass: Promise<unknown> = Promise.resolve();
  const loop = async () => {
    while (running) {
      pass = runApiJobs(db, workerId, log, handlers, batch).catch((error) =>
        log.error({ err: error, runner: name }, 'API runner pass failed'),
      );
      await pass;
      await Bun.sleep(POLL_MS);
    }
  };
  void loop();
  return async () => {
    running = false;
    await pass;
  };
}

export const startAutomationRunner = (db: Database, log: Logger) =>
  startApiRunner(db, log, 'automation', automationHandlers(db));
