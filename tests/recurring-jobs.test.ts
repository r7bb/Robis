import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { enqueue, jobs, scheduleRecurring } from '@robis/database';
import { asc, eq } from 'drizzle-orm';
import { closeHarness, getHarness, resetDatabase } from './harness.ts';

/**
 * Recurring jobs once each, however often the worker restarts: started only
 * when none is waiting, and copies that piled up before are dropped, the
 * soonest kept and one already running never touched.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const HOUR = 3_600_000;
const SCHEDULE = [
  { kind: 'sessions.cleanup', delayMs: HOUR },
  { kind: 'nudges.scan', delayMs: HOUR },
];

async function waiting(kind: string) {
  const { workerDb } = await getHarness();
  return workerDb.select().from(jobs).where(eq(jobs.kind, kind)).orderBy(asc(jobs.runAt));
}

describe('recurring jobs', () => {
  test('a restart, or ten, leaves one of each', async () => {
    const { workerDb } = await getHarness();
    const first = await scheduleRecurring(workerDb, SCHEDULE);
    expect(first.started).toEqual(['sessions.cleanup', 'nudges.scan']);
    for (let restart = 0; restart < 10; restart++) {
      expect((await scheduleRecurring(workerDb, SCHEDULE)).started).toEqual([]);
    }
    expect(await waiting('sessions.cleanup')).toHaveLength(1);
    expect(await waiting('nudges.scan')).toHaveLength(1);
  });

  test('copies already stacked up are dropped, the soonest kept', async () => {
    const { workerDb } = await getHarness();
    for (const delayMs of [3 * HOUR, HOUR, 2 * HOUR]) {
      await enqueue(workerDb, 'sessions.cleanup', {}, { delayMs });
    }
    const { dropped, started } = await scheduleRecurring(workerDb, SCHEDULE);
    expect(dropped).toBe(2);
    expect(started).toEqual(['nudges.scan']);
    const [kept, ...rest] = await waiting('sessions.cleanup');
    expect(rest).toEqual([]);
    expect(kept!.runAt.getTime()).toBeLessThan(Date.now() + 1.5 * HOUR);
  });

  test('one running is left alone, and other kinds are not touched', async () => {
    const { workerDb } = await getHarness();
    await enqueue(workerDb, 'sessions.cleanup', {}, { delayMs: HOUR });
    await enqueue(workerDb, 'sessions.cleanup', {}, { delayMs: 2 * HOUR });
    const [running] = await waiting('sessions.cleanup');
    await workerDb
      .update(jobs)
      .set({ lockedAt: new Date(), lockedBy: 'another-worker' })
      .where(eq(jobs.id, running!.id));
    await enqueue(workerDb, 'mail.signup', { userId: 'x' });
    await enqueue(workerDb, 'mail.signup', { userId: 'y' });

    const { dropped } = await scheduleRecurring(workerDb, SCHEDULE);
    expect(dropped).toBe(0);
    expect(await waiting('sessions.cleanup')).toHaveLength(2);
    expect(await waiting('mail.signup')).toHaveLength(2);
  });
});
