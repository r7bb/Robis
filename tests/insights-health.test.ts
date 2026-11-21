import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { acceptanceOf, readingOf } from '@robis/api/insights-health';
import { PER_PERSON_PER_MINUTE } from '@robis/api/sync-lag';
import {
  addCounts,
  BUCKETS,
  bucketOf,
  enqueue,
  InstrumentRecorder,
  instrumentReadings,
  jobs,
  KEPT_MINUTES,
  pruneReadings,
  quantileEdge,
  readInstrument,
  suggestionFeedback,
  users,
  writeReadings,
} from '@robis/database';
import { INSTRUMENT_BOUNDS_MS } from '@robis/shared';
import { eq } from 'drizzle-orm';
import {
  addMember,
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  getHarness,
  request,
  resetDatabase,
  TEST_OPERATOR_DOMAIN,
} from './harness.ts';

/**
 * System health (Phase 6), from real instruments. Done when: timings are
 * counted into fixed buckets that add up across instances and repeated
 * writes; quantiles from those buckets match hand-worked answers; a write
 * that fails keeps its minutes; the API counts the queue wait a browser
 * reports only for accepted writes; the page's figures come from the job
 * queue, the timings and the hint answers, below the minimum sample as
 * counts only; and only those who may read health see it.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const quiet = { warn() {} };
const zeros = () => new Array<number>(BUCKETS).fill(0);
const DAY = 86_400_000;

describe('buckets, without a database', () => {
  test('a timing falls in the first bucket whose edge is at or above it', () => {
    expect(BUCKETS).toBe(INSTRUMENT_BOUNDS_MS.length + 1);
    expect(bucketOf(0)).toBe(0);
    expect(bucketOf(10)).toBe(0);
    expect(bucketOf(11)).toBe(1);
    expect(bucketOf(1_000)).toBe(6);
    expect(bucketOf(86_400_000)).toBe(15);
    expect(bucketOf(86_400_001)).toBe(16);
  });

  test('quantiles by nearest rank, given as the bucket edge', () => {
    // Ten timings: four within 10 ms, three within 25, two within 100, one beyond a day.
    const counts = zeros();
    counts[0] = 4;
    counts[1] = 3;
    counts[3] = 2;
    counts[16] = 1;
    // Rank ceil(0.5 * 10) = 5 lands in the second bucket; ceil(0.95 * 10) = 10 beyond the last.
    expect(quantileEdge(counts, 0.5)).toBe(25);
    expect(quantileEdge(counts, 0.4)).toBe(10);
    expect(quantileEdge(counts, 0.9)).toBe(100);
    expect(quantileEdge(counts, 0.95)).toBeNull();
    expect(() => quantileEdge(zeros(), 0.5)).toThrow(RangeError);
  });

  test('counts add bucket by bucket', () => {
    const a = zeros().map((_, i) => i);
    expect(addCounts(a, a)[16]).toBe(32);
    expect(addCounts([], a)).toEqual(a);
  });

  test('below ten timings no figures; at ten, median and 95th percentile', () => {
    const nine = zeros();
    nine[2] = 9;
    expect(readingOf(nine)).toEqual({ count: 9, median: null, p95: null });
    const ten = [...nine];
    ten[5] = 1;
    expect(readingOf(ten)).toEqual({
      count: 10,
      median: { withinMs: 50 },
      p95: { withinMs: 500 },
    });
  });

  test('a hint rate only once ten have answered', () => {
    expect(acceptanceOf(5, 4)).toEqual({ accepted: 5, dismissed: 4, rate: null });
    expect(acceptanceOf(6, 4)).toEqual({ accepted: 6, dismissed: 4, rate: 0.6 });
  });
});

describe('recording timings', () => {
  test('two instances and two writes of one minute add up', async () => {
    const { ownerDb } = await getHarness();
    const minute = Date.UTC(2026, 10, 21, 12, 0);
    const clock = { now: minute + 5_000 };
    const one = new InstrumentRecorder(ownerDb, 'sync_lag', 'one', quiet, () => clock.now);
    const two = new InstrumentRecorder(ownerDb, 'sync_lag', 'two', quiet, () => clock.now);

    one.record(5); // bucket 0
    one.record(40); // bucket 2
    await one.flush();
    one.record(40); // the same minute, written again: added, not replaced
    two.record(-3); // a reading below zero counts as zero
    two.record(90_000_000); // beyond the last edge
    await Promise.all([one.flush(), two.flush()]);
    // Nothing held is written twice.
    await one.flush();

    const counts = await readInstrument(ownerDb, 'sync_lag', new Date(minute - 60_000));
    const expected = zeros();
    expected[0] = 2;
    expected[2] = 2;
    expected[16] = 1;
    expect(counts).toEqual(expected);
    expect(await ownerDb.select().from(instrumentReadings)).toHaveLength(2);
    // The other instrument is its own.
    expect(await readInstrument(ownerDb, 'fanout_latency', new Date(0))).toEqual(zeros());
  });

  test('a write that fails keeps its minutes for the next try', async () => {
    const { ownerDb } = await getHarness();
    let failing = true;
    const flaky = new Proxy(ownerDb, {
      get(target, property, receiver) {
        if (property === 'insert' && failing) {
          return () => {
            throw new Error('database away');
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const warnings: string[] = [];
    const recorder = new InstrumentRecorder(flaky, 'fanout_latency', 'flaky', {
      warn: (_fields, message) => warnings.push(message),
    });
    recorder.record(20);
    await recorder.flush();
    expect(warnings).toEqual(['timings could not be written']);
    failing = false;
    recorder.record(20);
    await recorder.flush();
    const counts = await readInstrument(ownerDb, 'fanout_latency', new Date(Date.now() - DAY));
    expect(counts[1]).toBe(2);
  });

  test('records made while a write fails are kept with it, and at most an hour of minutes', async () => {
    const { ownerDb } = await getHarness();
    let failing = true;
    const flaky = new Proxy(ownerDb, {
      get(target, property, receiver) {
        if (property === 'insert' && failing) {
          return () => {
            throw new Error('database away');
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const start = Date.UTC(2026, 10, 21, 0, 0);
    const clock = { now: start };
    const recorder = new InstrumentRecorder(flaky, 'sync_lag', 'held', quiet, () => clock.now);
    // Sixty-one minutes, one timing each, all failing to write.
    for (let m = 0; m <= KEPT_MINUTES; m++) {
      clock.now = start + m * 60_000;
      recorder.record(5);
      await recorder.flush();
    }
    // One more in the newest minute, recorded after the failures.
    recorder.record(5);
    failing = false;
    await recorder.flush();

    const rows = await ownerDb.select().from(instrumentReadings);
    // The first minute was dropped; the newest holds both of its timings.
    expect(rows).toHaveLength(KEPT_MINUTES);
    expect(Math.min(...rows.map((row) => row.minute.getTime()))).toBe(start + 60_000);
    const newest = rows.find((row) => row.minute.getTime() === start + KEPT_MINUTES * 60_000);
    expect(newest?.counts[0]).toBe(2);
  });

  test('stopping waits for a write already under way', async () => {
    const { ownerDb } = await getHarness();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = new Proxy(ownerDb, {
      get(target, property, receiver) {
        if (property === 'insert') {
          return (...args: unknown[]) => {
            const builder = (target.insert as (...a: unknown[]) => unknown)(...args) as {
              values: (v: unknown) => { onConflictDoUpdate: (c: unknown) => Promise<unknown> };
            };
            return {
              values: (v: unknown) => ({
                onConflictDoUpdate: async (c: unknown) => {
                  await gate;
                  return builder.values(v).onConflictDoUpdate(c);
                },
              }),
            };
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const recorder = new InstrumentRecorder(slow, 'sync_lag', 'slow', quiet);
    recorder.record(5);
    const inFlight = recorder.flush();
    let stopped = false;
    const stopping = recorder.stop().then(() => {
      stopped = true;
    });
    await Bun.sleep(20);
    expect(stopped).toBe(false);
    release();
    await Promise.all([inFlight, stopping]);
    expect(await ownerDb.select().from(instrumentReadings)).toHaveLength(1);
  });

  test('the worker sweeps readings older than a week, as its own role', async () => {
    const { ownerDb, workerDb } = await getHarness();
    const now = new Date();
    const counts = zeros().map((_, i) => (i === 0 ? 1 : 0));
    await writeReadings(ownerDb, [
      { instrument: 'sync_lag', source: 'a', minute: new Date(now.getTime() - 8 * DAY), counts },
      { instrument: 'sync_lag', source: 'a', minute: new Date(now.getTime() - 6 * DAY), counts },
    ]);
    expect(await pruneReadings(workerDb, now)).toBe(1);
    expect(await ownerDb.select().from(instrumentReadings)).toHaveLength(1);
  });
});

describe('sync lag, as the API counts it', () => {
  test('counted for accepted writes that report it, and nothing else', async () => {
    const { app, ownerDb } = await getHarness();
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const project = await createProject(owner, workspace.id);
    const made = await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      method: 'POST',
      actor: owner,
      payload: { title: 'Written offline' },
      headers: { 'robis-queued-for': '1500' },
    });
    expect(made.statusCode).toBe(201);
    const url = `/workspaces/${workspace.id}/issues/${made.json().issue.id}`;
    // Accepted, waited 40 ms.
    await request(url, {
      method: 'PATCH',
      actor: owner,
      payload: { status: 'IN_PROGRESS' },
      headers: { 'robis-queued-for': '40' },
    });
    // Refused: not counted.
    await request(url, {
      method: 'PATCH',
      actor: owner,
      payload: { status: 'NOT_A_STATUS' },
      headers: { 'robis-queued-for': '40' },
    });
    // Not a count, or more than a week: not counted.
    for (const value of ['12abc', '-5', String(8 * DAY)]) {
      await request(url, {
        method: 'PATCH',
        actor: owner,
        payload: { priority: 'LOW' },
        headers: { 'robis-queued-for': value },
      });
    }
    // A read: not counted.
    await request(url, { actor: owner, headers: { 'robis-queued-for': '40' } });
    // A replay of an answered write: counted once, when it was first accepted.
    for (let i = 0; i < 2; i++) {
      await request(url, {
        method: 'PATCH',
        actor: owner,
        payload: { status: 'IN_REVIEW' },
        headers: { 'robis-queued-for': '60000', 'idempotency-key': 'replayed-once' },
      });
    }
    // Signed out: not counted, even where the write is accepted.
    const anonymous = await request('/auth/signup', {
      method: 'POST',
      payload: { email: `nobody-${Date.now()}@robis.test` },
      headers: { 'robis-queued-for': '40' },
    });
    expect(anonymous.statusCode).toBe(202);

    await app.syncLag.flush();
    const counts = await readInstrument(ownerDb, 'sync_lag', new Date(Date.now() - DAY));
    const expected = zeros();
    expected[bucketOf(1500)] = 1;
    expected[bucketOf(40)] = 1;
    expected[bucketOf(60_000)] = 1;
    expect(counts).toEqual(expected);
  });

  test('at most thirty timings from one person a minute', async () => {
    const { app, ownerDb } = await getHarness();
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const project = await createProject(owner, workspace.id);
    const made = await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      method: 'POST',
      actor: owner,
      payload: { title: 'Drained in a burst' },
    });
    const url = `/workspaces/${workspace.id}/issues/${made.json().issue.id}`;
    // Kept clear of a minute's turn, which would start the allowance afresh.
    if (Date.now() % 60_000 > 50_000) await Bun.sleep(60_000 - (Date.now() % 60_000) + 50);
    for (let i = 0; i < PER_PERSON_PER_MINUTE + 5; i++) {
      await request(url, {
        method: 'PATCH',
        actor: owner,
        payload: { title: `Edit ${i}` },
        headers: { 'robis-queued-for': '20' },
      });
    }
    await app.syncLag.flush();
    const counts = await readInstrument(ownerDb, 'sync_lag', new Date(Date.now() - DAY));
    expect(counts[bucketOf(20)]).toBe(PER_PERSON_PER_MINUTE);
  });
});

describe('the health page', () => {
  /** A workspace owned by someone who runs the server. */
  async function workspaceWithAdmin() {
    const owner = await createActor('Operator', {
      email: `owner-${crypto.randomUUID()}@${TEST_OPERATOR_DOMAIN}`,
    });
    const workspace = await createWorkspace(owner);
    return { owner, workspace };
  }

  test('the queue, the timings and the hint answers, each from its instrument', async () => {
    const { ownerDb, workerDb } = await getHarness();
    const { owner, workspace } = await workspaceWithAdmin();
    const other = await createWorkspace(owner, 'Elsewhere');

    // Two jobs due, the older waiting two minutes; one dead letter.
    await enqueue(workerDb, 'test.now', {});
    const old = await enqueue(workerDb, 'test.now', {});
    await ownerDb
      .update(jobs)
      .set({ runAt: new Date(Date.now() - 120_000) })
      .where(eq(jobs.id, old));
    const dead = await enqueue(workerDb, 'test.dead', {});
    await ownerDb.update(jobs).set({ status: 'failed' }).where(eq(jobs.id, dead));

    // Twelve live-update timings: eleven within 50 ms, one within 1 s. Sync lag: three.
    const fan = zeros();
    fan[2] = 11;
    fan[6] = 1;
    const lag = zeros();
    lag[8] = 3;
    const minute = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    await writeReadings(ownerDb, [
      { instrument: 'fanout_latency', source: 'g', minute, counts: fan },
      { instrument: 'sync_lag', source: 'a', minute, counts: lag },
      // Older than the day: left out.
      {
        instrument: 'fanout_latency',
        source: 'g',
        minute: new Date(minute.getTime() - 2 * DAY),
        counts: fan,
      },
    ]);

    // Hints: 8 used and 4 set aside here; 3 priority answers; old and elsewhere left out.
    const hint = (
      kind: 'duplicate' | 'priority',
      action: 'accepted' | 'dismissed',
      at = new Date(),
    ) => ({
      workspaceId: workspace.id,
      kind,
      action,
      at,
    });
    await ownerDb
      .insert(suggestionFeedback)
      .values([
        ...Array.from({ length: 8 }, () => hint('duplicate', 'accepted')),
        ...Array.from({ length: 4 }, () => hint('duplicate', 'dismissed')),
        ...Array.from({ length: 3 }, () => hint('priority', 'accepted')),
        hint('duplicate', 'dismissed', new Date(Date.now() - 40 * DAY)),
        { ...hint('duplicate', 'dismissed'), workspaceId: other.id },
      ]);

    const reply = await request(`/workspaces/${workspace.id}/insights/health`, { actor: owner });
    expect(reply.statusCode).toBe(200);
    const health = reply.json();
    expect(health.hours).toBe(24);
    expect(health.minSample).toBe(10);
    expect(health.server.queue.due).toBe(2);
    expect(health.server.queue.oldestDueSeconds).toBeGreaterThanOrEqual(119);
    expect(health.server.queue.deadLetters).toBe(1);
    expect(health.server.fanOut).toEqual({
      count: 12,
      median: { withinMs: 50 },
      p95: { withinMs: 1000 },
    });
    expect(health.server.syncLag).toEqual({ count: 3, median: null, p95: null });
    expect(health.suggestions).toEqual({
      days: 30,
      duplicate: { accepted: 8, dismissed: 4, rate: 8 / 12 },
      priority: { accepted: 3, dismissed: 0, rate: null },
    });
  });

  test('an empty queue says nothing is waiting, not that it waited zero', async () => {
    const { owner, workspace } = await workspaceWithAdmin();
    const reply = await request(`/workspaces/${workspace.id}/insights/health`, { actor: owner });
    expect(reply.json().server.queue).toEqual({ due: 0, oldestDueSeconds: null, deadLetters: 0 });
  });

  test('a workspace owner who does not run the server sees the hints, not the server', async () => {
    // Anyone can sign up and own a workspace; that is not running the server.
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const reply = await request(`/workspaces/${workspace.id}/insights/health`, { actor: owner });
    expect(reply.statusCode).toBe(200);
    expect(reply.json().server).toBeNull();
    expect(reply.json().suggestions.duplicate).toEqual({ accepted: 0, dismissed: 0, rate: null });
  });

  test('an exact operator address counts; an unverified one does not', async () => {
    const { ownerDb } = await getHarness();
    const listed = await createActor('Ops', { email: 'ops@robis.test' });
    const workspace = await createWorkspace(listed);
    const url = `/workspaces/${workspace.id}/insights/health`;
    expect((await request(url, { actor: listed })).json().server).not.toBeNull();
    await ownerDb.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, listed.id));
    expect((await request(url, { actor: listed })).json().server).toBeNull();
  });

  test('admins may; members get 403, strangers 404', async () => {
    const { owner, workspace } = await workspaceWithAdmin();
    const admin = await createActor('Admin');
    const member = await createActor('Member');
    await addMember(owner, workspace.id, admin, 'ADMIN');
    await addMember(owner, workspace.id, member, 'MEMBER');
    const stranger = await createActor('Stranger');
    const url = `/workspaces/${workspace.id}/insights/health`;
    expect((await request(url, { actor: admin })).statusCode).toBe(200);
    expect((await request(url, { actor: member })).statusCode).toBe(403);
    expect((await request(url, { actor: stranger })).statusCode).toBe(404);
    expect((await request(url)).statusCode).toBe(401);
  });
});
