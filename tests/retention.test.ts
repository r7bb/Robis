import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  IDEMPOTENCY_REPLAY_DAYS,
  mutations,
  NOTIFICATION_RETENTION_DAYS,
  notifications,
} from '@robis/database';
import { cleanupSessions } from '@robis/worker/handlers';
import { eq, sql } from 'drizzle-orm';
import {
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  getHarness,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * What is kept, and for how long (stage 3, item 30): an idempotency key
 * replays for 30 days and is then forgotten; a read notification goes after
 * 90 days. Both are removed by the worker's hourly cleanup, as its own
 * database account.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

async function runCleanup() {
  const { workerDb } = await getHarness();
  await cleanupSessions({}, { db: workerDb });
}

async function createIssueWithKey(key: string) {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const project = await createProject(owner, workspace.id);
  const url = `/workspaces/${workspace.id}/projects/${project.id}/issues`;
  const send = () =>
    request(url, {
      method: 'POST',
      payload: { title: 'Once' },
      actor: owner,
      headers: { 'idempotency-key': key },
    });
  return { first: await send(), send };
}

async function backdateKey(key: string, days: number) {
  const { ownerDb } = await getHarness();
  await ownerDb
    .update(mutations)
    .set({ createdAt: daysAgo(days) })
    .where(eq(mutations.key, key));
}

describe('the idempotency ledger', () => {
  test('the replay window is 30 days', () => {
    expect(IDEMPOTENCY_REPLAY_DAYS).toBe(30);
  });

  test('a replay inside the window still returns the stored response', async () => {
    const key = '21111111-2222-4333-8444-555555555555';
    const { first, send } = await createIssueWithKey(key);
    await backdateKey(key, IDEMPOTENCY_REPLAY_DAYS - 1);

    await runCleanup();
    const replay = await send();

    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json().issue.id).toBe(first.json().issue.id);
  });

  test('a key older than the window is forgotten', async () => {
    const key = '31111111-2222-4333-8444-555555555555';
    await createIssueWithKey(key);
    await backdateKey(key, IDEMPOTENCY_REPLAY_DAYS + 1);

    await runCleanup();

    const { ownerDb } = await getHarness();
    expect(await ownerDb.select().from(mutations).where(eq(mutations.key, key))).toEqual([]);
  });
});

describe('notifications', () => {
  test('a read notification goes after 90 days; unread and recently read ones stay', async () => {
    expect(NOTIFICATION_RETENTION_DAYS).toBe(90);
    const actor = await createActor('Reader');
    const { ownerDb } = await getHarness();
    const base = { userId: actor.id, kind: 'nudge', entityType: 'user', payload: '{}' };
    await ownerDb.insert(notifications).values([
      { ...base, dedupeKey: 'old-read', createdAt: daysAgo(120), readAt: daysAgo(91) },
      { ...base, dedupeKey: 'recent-read', createdAt: daysAgo(120), readAt: daysAgo(10) },
      { ...base, dedupeKey: 'old-unread', createdAt: daysAgo(200), readAt: null },
    ]);

    await runCleanup();

    const left = await ownerDb
      .select({ key: notifications.dedupeKey })
      .from(notifications)
      .where(eq(notifications.userId, actor.id))
      .orderBy(sql`1`);
    expect(left.map((row) => row.key)).toEqual(['old-unread', 'recent-read']);
  });
});
