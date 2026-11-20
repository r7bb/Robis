import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { createSuggestionClient, type MlOutcome } from '@robis/api/suggestions';
import { advanceStreamCursor, enqueue, jobs } from '@robis/database';
import { workerMetrics } from '@robis/worker/metrics';
import { Runner } from '@robis/worker/runner';
import { eq } from 'drizzle-orm';
import {
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  getHarness,
  resetDatabase,
} from './harness.ts';

/**
 * The worker's metrics and the API's count of ML calls (A5): what the
 * alert rules read. Done when: jobs due, the oldest one's wait and dead
 * letters come from the queue; the audit stream's lag counts what its
 * receiver has not acknowledged; each job's outcome is counted by kind,
 * with any kind outside the handlers' list as `unknown`; and every call to
 * the ML service is counted by how it ended.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const quiet = { warn() {}, info() {}, error() {}, debug() {}, child: () => quiet } as never;

function sampleOf(rendered: string, line: string): number | undefined {
  const found = rendered.split('\n').find((row) => row.startsWith(`${line} `));
  return found === undefined ? undefined : Number(found.slice(line.length + 1));
}

describe('the queue, read at scrape time', () => {
  test('due jobs, the oldest one’s wait, and dead letters', async () => {
    const { workerDb: db, ownerDb } = await getHarness();
    await enqueue(db, 'test.later', {}, { delayMs: 60 * 60_000 });
    await enqueue(db, 'test.now', {});
    const old = await enqueue(db, 'test.now', {});
    await ownerDb
      .update(jobs)
      .set({ runAt: new Date(Date.now() - 120_000) })
      .where(eq(jobs.id, old));
    const deadId = await enqueue(db, 'test.dead', {});
    await ownerDb.update(jobs).set({ status: 'failed' }).where(eq(jobs.id, deadId));

    const metrics = workerMetrics(db, { knows: () => true, auditStream: false });
    await metrics.refresh();
    const rendered = metrics.registry.render();
    expect(sampleOf(rendered, 'robis_jobs_due')).toBe(2);
    expect(sampleOf(rendered, 'robis_jobs_oldest_due_age_seconds')).toBeGreaterThanOrEqual(119);
    expect(sampleOf(rendered, 'robis_jobs_dead_letters')).toBe(1);
    expect(sampleOf(rendered, 'robis_worker_queue_readable')).toBe(1);
    // With the stream off, no lag is reported at all, rather than a zero.
    expect(rendered).not.toContain('robis_audit_stream_lag_events');
  });

  test('the audit stream’s lag is what its receiver has not acknowledged', async () => {
    const { workerDb: db } = await getHarness();
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    await createProject(owner, workspace.id);
    const metrics = workerMetrics(db, { knows: () => true, auditStream: true });
    await metrics.refresh();
    const before = sampleOf(metrics.registry.render(), 'robis_audit_stream_lag_events') ?? 0;
    expect(before).toBeGreaterThan(0);

    await advanceStreamCursor(db, workspace.id, 1);
    await metrics.refresh();
    expect(sampleOf(metrics.registry.render(), 'robis_audit_stream_lag_events')).toBe(before - 1);
  });
});

describe('each job’s outcome', () => {
  test('counted by kind; a kind outside the handlers is unknown', async () => {
    const { workerDb: db } = await getHarness();
    const handlers = {
      'test.ok': async () => undefined,
      'test.fails': async () => {
        throw new Error('broken');
      },
    };
    const metrics = workerMetrics(db, {
      knows: (kind) => Object.hasOwn(handlers, kind),
      auditStream: false,
    });
    await enqueue(db, 'test.ok', {});
    await enqueue(db, 'test.fails', {});
    await enqueue(db, 'test.nobody', {});
    await new Runner({ db, handlers, observe: metrics.observe }).tick();

    const rendered = metrics.registry.render();
    expect(sampleOf(rendered, 'robis_jobs_total{kind="test.ok",outcome="completed"}')).toBe(1);
    expect(sampleOf(rendered, 'robis_jobs_total{kind="test.fails",outcome="retrying"}')).toBe(1);
    expect(sampleOf(rendered, 'robis_jobs_total{kind="unknown",outcome="dead"}')).toBe(1);
    expect(rendered).not.toContain('test.nobody');
  });
});

describe('calls to the ML service', () => {
  test('counted as ok, error or unreachable', async () => {
    const outcomes: MlOutcome[] = [];
    let status = 200;
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ similar: [], triage: null }, { status }),
    });
    try {
      const client = createSuggestionClient(
        { url: `http://localhost:${server.port}`, token: null, timeoutMs: 1000 },
        quiet,
        (outcome) => outcomes.push(outcome),
      );
      await client.suggest('ws', 'x');
      status = 503;
      await client.suggest('ws', 'x');
      const gone = createSuggestionClient(
        { url: 'http://127.0.0.1:1', token: null, timeoutMs: 500 },
        quiet,
        (outcome) => outcomes.push(outcome),
      );
      await gone.suggest('ws', 'x');
    } finally {
      server.stop(true);
    }
    expect(outcomes).toEqual(['ok', 'error', 'unreachable']);
  });
});
