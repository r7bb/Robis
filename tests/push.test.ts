import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { notifications, pushSubscriptions } from '@robis/database';
import { isAllowedPushEndpoint, PUSH_DEVICES_PER_USER } from '@robis/shared';
import { handlers } from '@robis/worker/handlers';
import {
  checkVapidKeys,
  generateVapidKeys,
  pushHandlers,
  vapidAuthorization,
} from '@robis/worker/push';
import { Runner } from '@robis/worker/runner';
import { eq } from 'drizzle-orm';
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
 * Web push (C3): a push says only that there is something new. It carries
 * no content (the ids-only rule), so it needs no encryption, only a VAPID
 * signature. It follows the same switches as every other channel.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123';

const b64url = (text: string) => Buffer.from(text, 'base64url');

describe('which push services are allowed', () => {
  test('the browsers’ own services, over https', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(
      true,
    );
    expect(isAllowedPushEndpoint('https://web.push.apple.com/QOz')).toBe(true);
    expect(isAllowedPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true);
  });

  test('nothing else: no plain http, no other host, no look-alike, no address', () => {
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://evil.example/fcm.googleapis.com')).toBe(false);
    expect(isAllowedPushEndpoint('https://web.push.apple.com.evil.example/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://169.254.169.254/latest')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com:8443/x')).toBe(false);
    expect(isAllowedPushEndpoint('not a url')).toBe(false);
  });
});

describe('the VAPID signature', () => {
  test('names the push service, expires within a day, and verifies with the public key', async () => {
    const keys = await generateVapidKeys();
    const now = new Date('2026-11-20T10:00:00Z');
    const header = await vapidAuthorization(ENDPOINT, keys, 'mailto:ops@robis.test', now);

    const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [jwt, key] = [match![1]!, match![2]!];
    expect(key).toBe(keys.publicKey);

    const [head, body, signature] = jwt.split('.') as [string, string, string];
    expect(JSON.parse(b64url(head).toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    const claims = JSON.parse(b64url(body).toString());
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(claims.sub).toBe('mailto:ops@robis.test');
    expect(claims.exp).toBeGreaterThan(now.getTime() / 1000);
    expect(claims.exp).toBeLessThanOrEqual(now.getTime() / 1000 + 24 * 3600);

    const publicKey = await crypto.subtle.importKey(
      'raw',
      b64url(keys.publicKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      b64url(signature),
      new TextEncoder().encode(`${head}.${body}`),
    );
    expect(ok).toBe(true);
  });
});

describe('the key pair', () => {
  test('two halves of one pair pass; halves of two pairs are caught at start-up', async () => {
    const one = await generateVapidKeys();
    const two = await generateVapidKeys();
    await expect(checkVapidKeys(one)).resolves.toBeUndefined();
    await expect(
      checkVapidKeys({ publicKey: one.publicKey, privateKey: two.privateKey }),
    ).rejects.toThrow('do not belong together');
  });
});

describe('subscribing a device', () => {
  test('the server says whether push is on, and its key', async () => {
    const response = await request('/push/key');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty('publicKey');
  });

  test('a device is added once, removed by its owner, and only an allowed service is taken', async () => {
    const alice = await createActor('Alice');
    const add = () =>
      request('/me/push-subscriptions', {
        method: 'POST',
        payload: { endpoint: ENDPOINT },
        actor: alice,
      });
    expect((await add()).statusCode).toBe(204);
    expect((await add()).statusCode).toBe(204);
    const { ownerDb } = await getHarness();
    expect(await ownerDb.select().from(pushSubscriptions)).toHaveLength(1);

    const bad = await request('/me/push-subscriptions', {
      method: 'POST',
      payload: { endpoint: 'https://evil.example/push' },
      actor: alice,
    });
    expect(bad.statusCode).toBe(400);

    const bob = await createActor('Bob');
    await request('/me/push-subscriptions', {
      method: 'DELETE',
      payload: { endpoint: ENDPOINT },
      actor: bob,
    });
    expect(await ownerDb.select().from(pushSubscriptions)).toHaveLength(1);
    await request('/me/push-subscriptions', {
      method: 'DELETE',
      payload: { endpoint: ENDPOINT },
      actor: alice,
    });
    expect(await ownerDb.select().from(pushSubscriptions)).toEqual([]);
  });

  test('a device taken over by another account moves to it', async () => {
    const alice = await createActor('Alice');
    const bob = await createActor('Bob');
    for (const actor of [alice, bob]) {
      await request('/me/push-subscriptions', {
        method: 'POST',
        payload: { endpoint: ENDPOINT },
        actor,
      });
    }
    const { ownerDb } = await getHarness();
    const rows = await ownerDb.select().from(pushSubscriptions);
    expect(rows.map((r) => r.userId)).toEqual([bob.id]);
  });

  test('an account keeps at most a few devices, the oldest dropping off', async () => {
    const alice = await createActor('Alice');
    for (let i = 0; i <= PUSH_DEVICES_PER_USER; i++) {
      const added = await request('/me/push-subscriptions', {
        method: 'POST',
        payload: { endpoint: `${ENDPOINT}-${i}` },
        actor: alice,
      });
      expect(added.statusCode).toBe(204);
    }
    const { ownerDb } = await getHarness();
    const rows = await ownerDb.select().from(pushSubscriptions);
    expect(rows).toHaveLength(PUSH_DEVICES_PER_USER);
    expect(rows.some((r) => r.endpoint === `${ENDPOINT}-0`)).toBe(false);
  });

  test('needs a session', async () => {
    const response = await request('/me/push-subscriptions', {
      method: 'POST',
      payload: { endpoint: ENDPOINT },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('sending', () => {
  type Sent = { url: string; headers: Record<string, string>; body: unknown };

  async function setUp(status = 201) {
    const alice = await createActor('Alice');
    const bob = await createActor('Bob');
    const workspace = await createWorkspace(alice);
    const project = await createProject(alice, workspace.id);
    await addMember(alice, workspace.id, bob, 'MEMBER');
    await request('/me/push-subscriptions', {
      method: 'POST',
      payload: { endpoint: ENDPOINT },
      actor: bob,
    });

    const sent: Sent[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      sent.push({ url, headers: init.headers as Record<string, string>, body: init.body });
      return new Response(null, { status });
    }) as unknown as typeof fetch;
    const keys = await generateVapidKeys();
    const push = pushHandlers({ keys, subject: 'mailto:ops@robis.test', fetcher });
    return { alice, bob, workspace, project, sent, push };
  }

  async function run(push: ReturnType<typeof pushHandlers>) {
    const { workerDb: db } = await getHarness();
    const all = { ...handlers, ...push };
    const runner = new Runner({ db, handlers: all, kinds: Object.keys(all) });
    for (let i = 0; i < 20; i++) if ((await runner.tick()).claimed === 0) break;
  }

  const give = (alice: Actor, bob: Actor, workspaceId: string, projectId: string) =>
    request(`/workspaces/${workspaceId}/projects/${projectId}/issues`, {
      method: 'POST',
      payload: { title: 'Fix the export', assigneeId: bob.id },
      actor: alice,
    });

  test('a notification pings each device, with nothing in it', async () => {
    const { alice, bob, workspace, project, sent, push } = await setUp();
    await give(alice, bob, workspace.id, project.id);
    await run(push);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(ENDPOINT);
    expect(sent[0]?.headers.Authorization).toMatch(/^vapid t=/);
    expect(sent[0]?.headers.TTL).toBeDefined();
    // Pings collapse: a phone that was off gets one, not one per notification.
    expect(sent[0]?.headers.Topic).toBe('robis');
    // The ids-only rule: no payload at all.
    expect(sent[0]?.body ?? null).toBeNull();

    const { workerDb: db } = await getHarness();
    const [row] = await db.select().from(notifications).where(eq(notifications.userId, bob.id));
    expect(row?.pushedAt).not.toBeNull();
  });

  test('a job run again after it went pings nobody twice', async () => {
    const { alice, bob, workspace, project, sent, push } = await setUp();
    await give(alice, bob, workspace.id, project.id);
    await run(push);
    const { workerDb: db } = await getHarness();
    const [row] = await db.select().from(notifications).where(eq(notifications.userId, bob.id));
    await push['push.notification']!({ notificationId: row!.id }, { db });
    expect(sent).toHaveLength(1);
  });

  test('a device the service says is gone is forgotten', async () => {
    const { alice, bob, workspace, project, push } = await setUp(410);
    await give(alice, bob, workspace.id, project.id);
    await run(push);
    const { workerDb: db } = await getHarness();
    expect(await db.select().from(pushSubscriptions)).toEqual([]);
  });

  test('a device the service refuses as malformed is dropped too', async () => {
    const { alice, bob, workspace, project, push } = await setUp(400);
    await give(alice, bob, workspace.id, project.id);
    await run(push);
    const { workerDb: db } = await getHarness();
    expect(await db.select().from(pushSubscriptions)).toEqual([]);
  });

  test('a refusal of our own key keeps the device and does not retry', async () => {
    const { alice, bob, workspace, project, sent, push } = await setUp(403);
    await give(alice, bob, workspace.id, project.id);
    await run(push);
    const { workerDb: db } = await getHarness();
    expect(await db.select().from(pushSubscriptions)).toHaveLength(1);
    // Tried once: retrying a key the service refuses cannot help.
    expect(sent).toHaveLength(1);
  });

  test('a service that is down is tried again, and the error never names the device', async () => {
    const { alice, bob, workspace, project, push } = await setUp(503);
    await give(alice, bob, workspace.id, project.id);
    // Makes the notification; its push fails and waits to be tried again.
    await run(push);
    const { workerDb: db } = await getHarness();
    const [row] = await db.select().from(notifications).where(eq(notifications.userId, bob.id));
    const failed = push['push.notification']!({ notificationId: row!.id }, { db });
    await expect(failed).rejects.toThrow('503');
    await expect(failed).rejects.not.toThrow('fcm.googleapis.com');
    expect(await db.select().from(pushSubscriptions)).toHaveLength(1);
  });

  test('push off for the kind: no ping', async () => {
    const { alice, bob, workspace, project, sent, push } = await setUp();
    await request('/me/notification-settings', {
      method: 'PUT',
      payload: { kind: 'assignment', channel: 'push', enabled: false },
      actor: bob,
    });
    await give(alice, bob, workspace.id, project.id);
    await run(push);
    expect(sent).toEqual([]);
  });

  test('a kind off everywhere stops it on every channel, push included', async () => {
    const { alice, bob, workspace, project, sent, push } = await setUp();
    for (const channel of ['in_app', 'email', 'push']) {
      await request('/me/notification-settings', {
        method: 'PUT',
        payload: { kind: 'assignment', channel, enabled: false },
        actor: bob,
      });
    }
    await give(alice, bob, workspace.id, project.id);
    await run(push);
    expect(sent).toEqual([]);
    const { workerDb: db } = await getHarness();
    expect(await db.select().from(notifications).where(eq(notifications.userId, bob.id))).toEqual(
      [],
    );
  });
});
