import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { jobs, WORKSPACE_WEBHOOK_JOB, webhookDeliveries } from '@robis/database';
import { receive, signDelivery, workspaceWebhookHandler } from '@robis/worker/workspace-webhook';
import { and, eq } from 'drizzle-orm';
import {
  type Actor,
  addMember,
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  getHarness,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * Outgoing webhooks (C7). Done when: a test receiver verifies the
 * signature and drops a retried duplicate by its delivery id; a failing
 * receiver is retried and then given up; a webhook whose maker can no
 * longer read the event sends nothing; and only admins manage them.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

type Received = { verdict: string; body: Record<string, unknown> };
let server: ReturnType<typeof Bun.serve> | null = null;
afterEach(() => {
  server?.stop(true);
  server = null;
});

/** A receiver on this machine, as a team's own would be, answering `status`. */
function receiver(secret: () => string, status = 200) {
  const seen = new Set<string>();
  const got: Received[] = [];
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.text();
      got.push({ verdict: receive(secret(), req.headers, body, seen), body: JSON.parse(body) });
      return new Response(null, { status });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/hook`, got };
}

async function setUp() {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const project = await createProject(owner, workspace.id);
  return { owner, workspace, project };
}

async function addHook(actor: Actor, workspaceId: string, events = ['issue.created']) {
  const made = await request(`/workspaces/${workspaceId}/webhooks`, {
    method: 'POST',
    actor,
    payload: { url: 'https://hooks.example.com/robis', events },
  });
  return made;
}

/** Run every queued delivery once against `url`, as the worker would, then clear the jobs. */
async function deliver(
  url: string,
  refuse: (url: string) => Promise<string | null> = async () => null,
) {
  const { workerDb, ownerDb } = await getHarness();
  const handler = workspaceWebhookHandler({ refuse, fetcher: (_to, init) => fetch(url, init) });
  const queued = await ownerDb.select().from(jobs).where(eq(jobs.kind, WORKSPACE_WEBHOOK_JOB));
  for (const job of queued) {
    const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
    await handler(payload, { db: workerDb });
    await ownerDb.delete(jobs).where(eq(jobs.id, job.id));
  }
  return queued.length;
}

describe('a workspace webhook', () => {
  test('signs each delivery, and the receiver drops a retried duplicate by its id', async () => {
    const { owner, workspace, project } = await setUp();
    const made = await addHook(owner, workspace.id);
    expect(made.statusCode).toBe(201);
    const secret = made.json().secret as string;
    const listed = await request(`/workspaces/${workspace.id}/webhooks`, { actor: owner });
    expect(JSON.stringify(listed.json())).not.toContain(secret);

    const hook = receiver(() => secret);
    await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      method: 'POST',
      actor: owner,
      payload: { title: 'Words stay inside' },
    });
    expect(await deliver(hook.url)).toBe(1);
    expect(hook.got.map((g) => g.verdict)).toEqual(['accepted']);
    const body = hook.got[0]!.body;
    expect(body).toMatchObject({ event: 'issue.created', workspaceId: workspace.id });
    expect((body.issue as { key: string }).key).toMatch(/^[A-Z0-9]+-1$/);
    expect(JSON.stringify(body)).not.toContain('Words stay inside');

    // The acknowledgement is lost and the delivery goes again: same id, dropped.
    const { ownerDb } = await getHarness();
    const [sent] = await ownerDb.select().from(webhookDeliveries);
    await ownerDb.update(webhookDeliveries).set({ status: 'pending' });
    await workspaceWebhookHandler({
      refuse: async () => null,
      fetcher: (_to, init) => fetch(hook.url, init),
    })({ deliveryId: sent!.id }, { db: (await getHarness()).workerDb });
    expect(hook.got.map((g) => g.verdict)).toEqual(['accepted', 'duplicate']);

    const log = await request(
      `/workspaces/${workspace.id}/webhooks/${made.json().webhook.id}/deliveries`,
      { actor: owner },
    );
    expect(log.json().deliveries[0]).toMatchObject({ status: 'delivered', lastStatusCode: 200 });
  });

  test('a name that does not resolve counts as a failed try, not a stuck one', async () => {
    const { owner, workspace, project } = await setUp();
    await addHook(owner, workspace.id);
    await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      method: 'POST',
      actor: owner,
      payload: { title: 'Nowhere' },
    });
    await deliver('http://127.0.0.1:1/unused', async () => {
      throw new Error('getaddrinfo ENOTFOUND hooks.example.com');
    });
    const { ownerDb } = await getHarness();
    const [row] = await ownerDb.select().from(webhookDeliveries);
    expect(row).toMatchObject({ status: 'pending', attempts: 1 });
    expect(row!.lastError).toContain('ENOTFOUND');
  });

  test('a tampered body, an old or missing timestamp is refused by the receiver', () => {
    const secret = 'shh';
    const body = '{"id":"d1"}';
    const now = Date.now();
    const timestamp = String(Math.floor(now / 1000));
    const headers = (ts: string, signed: string) =>
      new Headers({
        'x-robis-timestamp': ts,
        'x-robis-delivery': 'd1',
        'x-robis-signature': signDelivery(secret, ts, signed),
      });
    expect(receive(secret, headers(timestamp, body), '{"id":"d2"}', new Set(), now)).toBe(
      'bad signature',
    );
    const old = String(Math.floor(now / 1000) - 600);
    expect(receive(secret, headers(old, body), body, new Set(), now)).toBe('stale');
    expect(receive(secret, headers('soon', body), body, new Set(), now)).toBe('stale');
    expect(receive(secret, headers(timestamp, body), body, new Set(), now)).toBe('accepted');
  });

  test('a failing receiver is retried on a growing schedule, then given up as failed', async () => {
    const { owner, workspace, project } = await setUp();
    const secret = (await addHook(owner, workspace.id)).json().secret as string;
    const hook = receiver(() => secret, 500);
    await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      method: 'POST',
      actor: owner,
      payload: { title: 'Down' },
    });
    const { ownerDb } = await getHarness();
    const delays: number[] = [];
    for (let i = 0; i < 5; i++) {
      await deliver(hook.url);
      const [next] = await ownerDb.select().from(jobs).where(eq(jobs.kind, WORKSPACE_WEBHOOK_JOB));
      if (next) delays.push(Math.round((next.runAt.getTime() - Date.now()) / 60_000));
    }
    // A minute, five, half an hour, two hours; then no more.
    expect(delays).toEqual([1, 5, 30, 120]);
    expect(hook.got).toHaveLength(5);
    const [row] = await ownerDb.select().from(webhookDeliveries);
    expect(row).toMatchObject({ status: 'failed', attempts: 5, lastStatusCode: 500 });
  });

  test('sends nothing once its maker has left, or while it is off', async () => {
    const { owner, workspace, project } = await setUp();
    const admin = await createActor('Admin');
    await addMember(owner, workspace.id, admin, 'ADMIN');
    const made = await addHook(admin, workspace.id);
    const hook = receiver(() => made.json().secret);
    await request(`/workspaces/${workspace.id}/members/${admin.id}`, {
      method: 'DELETE',
      actor: owner,
    });
    await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      method: 'POST',
      actor: owner,
      payload: { title: 'After they left' },
    });
    await deliver(hook.url);
    expect(hook.got).toHaveLength(0);
    const { ownerDb } = await getHarness();
    const [row] = await ownerDb
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, made.json().webhook.id));
    expect(row).toMatchObject({ status: 'skipped' });

    const own = await addHook(owner, workspace.id);
    await request(`/workspaces/${workspace.id}/webhooks/${own.json().webhook.id}`, {
      method: 'PATCH',
      actor: owner,
      payload: { enabled: false },
    });
    await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      method: 'POST',
      actor: owner,
      payload: { title: 'While off' },
    });
    const queued = await ownerDb
      .select()
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.webhookId, own.json().webhook.id)));
    expect(queued).toHaveLength(0);
  });

  test('only admins manage webhooks, and only https addresses are taken', async () => {
    const { owner, workspace } = await setUp();
    const member = await createActor('Member');
    await addMember(owner, workspace.id, member, 'MEMBER');
    expect((await addHook(member, workspace.id)).statusCode).toBe(403);
    const plain = await request(`/workspaces/${workspace.id}/webhooks`, {
      method: 'POST',
      actor: owner,
      payload: { url: 'http://hooks.example.com/robis', events: ['issue.created'] },
    });
    expect(plain.statusCode).toBe(400);
    const unknown = await request(`/workspaces/${workspace.id}/webhooks`, {
      method: 'POST',
      actor: owner,
      payload: { url: 'https://hooks.example.com/robis', events: ['secrets.leaked'] },
    });
    expect(unknown.statusCode).toBe(400);
  });
});
