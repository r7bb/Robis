import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createDatabase,
  enqueue,
  listenForJobs,
  MAIL_EMAIL_VERIFICATION_JOB,
  MAIL_JOBS,
  queueVerificationMail,
} from '@robis/database';
import { Runner } from '@robis/worker/runner';
import {
  closeHarness,
  createActor,
  getHarness,
  resetDatabase,
  TEST_URL,
  WORKER_TEST_ROLE,
} from './harness.ts';

/**
 * The worker wakes on a notification `enqueue` sends in the same
 * transaction (stage 3, item 26), instead of polling every second; it still
 * looks every 30 seconds in case a notification was missed.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

function workerUrl(): string {
  const url = new URL(TEST_URL);
  url.username = WORKER_TEST_ROLE.role;
  url.password = WORKER_TEST_ROLE.password;
  return url.toString();
}

async function until(check: () => boolean, timeoutMs: number) {
  const deadline = performance.now() + timeoutMs;
  while (!check() && performance.now() < deadline) await Bun.sleep(2);
}

/** A runner that would otherwise sleep for 30 s, woken by the listener. */
async function wakeableRunner(onStart: () => void) {
  const { workerDb } = await getHarness();
  const runner = new Runner({
    db: workerDb,
    handlers: { 'mail.probe': async () => onStart() },
    kinds: ['mail.probe'],
    idleDelayMs: 30_000,
  });
  const listener = await listenForJobs(workerUrl(), () => runner.wake());
  const running = runner.start();
  // Let it find the queue empty and go to sleep.
  await Bun.sleep(300);
  return {
    runner,
    async stop() {
      runner.stop();
      await running;
      await listener.close();
    },
  };
}

describe('waking the worker', () => {
  test('a mail job starts within 100 ms of being queued', async () => {
    const { db } = await getHarness();
    let startedAt = 0;
    const worker = await wakeableRunner(() => {
      startedAt = performance.now();
    });
    try {
      const queuedAt = performance.now();
      await enqueue(db, 'mail.probe', {});
      await until(() => startedAt > 0, 2000);
      expect(startedAt).toBeGreaterThan(0);
      expect(startedAt - queuedAt).toBeLessThan(100);
    } finally {
      await worker.stop();
    }
  });

  test('a job queued in a transaction is not started before it commits', async () => {
    const { db } = await getHarness();
    let startedAt = 0;
    const worker = await wakeableRunner(() => {
      startedAt = performance.now();
    });
    try {
      let committedAt = 0;
      await db.transaction(async (tx) => {
        await enqueue(tx, 'mail.probe', {});
        await Bun.sleep(200);
        expect(startedAt).toBe(0);
        committedAt = performance.now();
      });
      await until(() => startedAt > 0, 2000);
      expect(startedAt).toBeGreaterThan(committedAt);
      expect(startedAt - committedAt).toBeLessThan(100);
    } finally {
      await worker.stop();
    }
  });

  test('idle, it keeps its heartbeat without asking the database for work', async () => {
    const { workerDb } = await getHarness();
    let beats = 0;
    const runner = new Runner({
      db: workerDb,
      handlers: {},
      kinds: ['mail.probe'],
      idleDelayMs: 30_000,
      beatMs: 50,
      onPoll: () => {
        beats += 1;
      },
    });
    const running = runner.start();
    await Bun.sleep(400);
    runner.stop();
    await running;
    // One poll at the start, then a beat every 50 ms while it waits.
    expect(beats).toBeGreaterThanOrEqual(4);
  });

  test('after a poll that failed, it does not beat: the health check sees the database gone', async () => {
    // A database nothing is listening on: every poll fails.
    const gone = createDatabase('postgres://robis:robis@127.0.0.1:1/robis', { max: 1 });
    let beats = 0;
    const runner = new Runner({
      db: gone.db,
      handlers: {},
      idleDelayMs: 30_000,
      beatMs: 50,
      onPoll: () => {
        beats += 1;
      },
    });
    const running = runner.start();
    await Bun.sleep(400);
    runner.stop();
    await running;
    await gone.close();
    expect(beats).toBe(0);
  });

  test('every way a job is queued wakes the worker, mail included', async () => {
    // Mail jobs are queued by their own inserts (de-duplicated per row), not
    // through enqueue; each must wake the worker too.
    const { db, workerDb } = await getHarness();
    const actor = await createActor('Mailed');
    const started: string[] = [];
    const runner = new Runner({
      db: workerDb,
      handlers: Object.fromEntries(
        MAIL_JOBS.map((kind) => [kind, async () => void started.push(kind)]),
      ),
      kinds: MAIL_JOBS,
      idleDelayMs: 30_000,
    });
    const listener = await listenForJobs(workerUrl(), () => runner.wake());
    const running = runner.start();
    await Bun.sleep(300);
    try {
      const queuedAt = performance.now();
      await queueVerificationMail(db, actor.id);
      await until(() => started.length > 0, 2000);
      expect(started).toEqual([MAIL_EMAIL_VERIFICATION_JOB]);
      expect(performance.now() - queuedAt).toBeLessThan(150);
    } finally {
      runner.stop();
      await running;
      await listener.close();
    }
  });

  test('no code queues a job without waking the worker', () => {
    // Each insert into the jobs table sits beside a wakeWorkers call, so a
    // new way of queueing cannot quietly fall back to the 30-second poll.
    const dir = join(import.meta.dir, '../backend/database/src');
    const unwoken = readdirSync(dir)
      .filter((name) => name.endsWith('.ts'))
      .flatMap((name) => {
        const source = readFileSync(join(dir, name), 'utf8');
        const inserts = source.match(/\.insert\(jobs\)/g)?.length ?? 0;
        const wakes = source.match(/await wakeWorkers\(/g)?.length ?? 0;
        return inserts > wakes ? [`${name}: ${inserts} inserts, ${wakes} wakes`] : [];
      });
    expect(unwoken).toEqual([]);
  });
});
