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
 * The API's own runner, for automation jobs alone (B9): only the API signs
 * the audit trail and holds the write paths a rule's action goes through,
 * so the worker leaves these jobs and this loop takes them. Jobs are
 * claimed with SKIP LOCKED, so several API instances share them safely.
 */

/** A rule fires within a second or two of the change that set it off. */
const POLL_MS = 1_000;
const BATCH = 10;

type Logger = { error: (fields: object, message: string) => void };

/** One pass: claim what is due, run it, and say how many ran. */
export async function runAutomationJobs(
  db: Database,
  workerId: string,
  log: Logger,
): Promise<number> {
  const batch = await claimJobs(db, workerId, BATCH, new Date(), [AUTOMATION_JOB]);
  for (const job of batch) {
    try {
      await evaluateAutomation(db, job.payload as AutomationJob);
      await completeJob(db, job.id);
    } catch (error) {
      log.error({ err: error, jobId: job.id }, 'automation job failed');
      await failJob(db, job, error);
    }
  }
  return batch.length;
}

/** Poll until stopped; `stop` resolves once the pass under way has finished. */
export function startAutomationRunner(db: Database, log: Logger) {
  const workerId = `api-automation-${crypto.randomUUID()}`;
  let running = true;
  let pass: Promise<unknown> = Promise.resolve();
  const loop = async () => {
    while (running) {
      pass = runAutomationJobs(db, workerId, log).catch((error) =>
        log.error({ err: error }, 'automation runner pass failed'),
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
