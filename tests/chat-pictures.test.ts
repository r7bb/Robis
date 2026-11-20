import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { auditEvents, workspaceStorageUsed } from '@robis/database';
import { localDiskStorage } from '@robis/storage';
import { Runner } from '@robis/worker/runner';
import { storagePurgeHandler } from '@robis/worker/storage-purge';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import {
  ACTOR_PASSWORD,
  type Actor,
  addMember,
  closeHarness,
  createActor,
  createWorkspace,
  getHarness,
  MEDIA_ROOT,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * Pictures in chat (B2). Done when: a pasted screenshot or photo posts to
 * the room as its own message, stripped of metadata and shown to members
 * only; a replay stores one file; every upload is audited; the file goes
 * with its message, its room and its workspace; it counts toward the
 * workspace's storage, and shows on its author's profile.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const SECRET = 'LOCATION-53.4808N-2.2426W';

function screenshot(width = 1280, height = 800) {
  return sharp({ create: { width, height, channels: 3, background: '#6366f1' } })
    .png()
    .withExif({ IFD0: { Artist: SECRET } })
    .toBuffer();
}

async function post(
  actor: Actor,
  workspaceId: string,
  channelId: string,
  body: Buffer,
  key?: string,
) {
  const { app } = await getHarness();
  return app.inject({
    method: 'POST',
    url: `/workspaces/${workspaceId}/channels/${channelId}/images`,
    headers: {
      cookie: actor.cookie,
      'content-type': 'image/png',
      ...(key ? { 'idempotency-key': key } : {}),
    },
    payload: body,
  });
}

async function fetchImage(actor: Actor, url: string) {
  const { app } = await getHarness();
  return app.inject({ method: 'GET', url, headers: { cookie: actor.cookie } });
}

function chatFiles(workspaceId: string): string[] {
  try {
    return readdirSync(join(MEDIA_ROOT, 'chat', workspaceId));
  } catch {
    return [];
  }
}

async function runPurges() {
  const { workerDb: db } = await getHarness();
  const runner = new Runner({
    db,
    handlers: { 'storage.purge': storagePurgeHandler(localDiskStorage(MEDIA_ROOT)) },
  });
  await runner.tick();
}

async function room() {
  const owner = await createActor('Owner');
  const member = await createActor('Member');
  const workspace = await createWorkspace(owner);
  await addMember(owner, workspace.id, member, 'MEMBER');
  const channel = (await request(`/workspaces/${workspace.id}/channels`, { actor: owner })).json()
    .channels[0] as { id: string };
  return { owner, member, workspace, channel };
}

const history = async (actor: Actor, workspaceId: string, channelId: string) =>
  (await request(`/workspaces/${workspaceId}/channels/${channelId}/messages`, { actor })).json()
    .messages as { id: string; body: string; image: { url: string; width: number } | null }[];

describe('posting a picture', () => {
  test('is its own message, stripped of metadata, served to members only, and audited', async () => {
    const { owner, member, workspace, channel } = await room();
    const stranger = await createActor('Stranger');
    const original = await screenshot();
    expect(original.includes(SECRET)).toBe(true);

    const posted = await post(member, workspace.id, channel.id, original);
    expect(posted.statusCode).toBe(201);
    const { message } = posted.json();
    expect(message).toMatchObject({ body: '', authorId: member.id });
    expect(message.image).toMatchObject({ width: 1280, height: 800 });

    const [shown] = await history(owner, workspace.id, channel.id);
    expect(shown!.image!.url).toBe(`/workspaces/${workspace.id}/messages/${message.id}/image`);

    const served = await fetchImage(owner, shown!.image!.url);
    expect(served.statusCode).toBe(200);
    expect(served.headers['cache-control']).toMatch(/^private/);
    expect(served.rawPayload.includes(SECRET)).toBe(false);
    expect((await sharp(served.rawPayload).metadata()).exif).toBeUndefined();
    expect((await fetchImage(stranger, shown!.image!.url)).statusCode).toBe(404);
    expect((await post(stranger, workspace.id, channel.id, original)).statusCode).toBe(404);

    const { ownerDb } = await getHarness();
    const audited = await ownerDb
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.eventType, 'message.image_added'));
    expect(audited).toHaveLength(1);
  });

  test('a text message still has no picture', async () => {
    const { owner, workspace, channel } = await room();
    await request(`/workspaces/${workspace.id}/channels/${channel.id}/messages`, {
      method: 'POST',
      actor: owner,
      payload: { body: 'Morning' },
    });
    const [shown] = await history(owner, workspace.id, channel.id);
    expect(shown).toMatchObject({ body: 'Morning', image: null });
  });

  test('a replay stores one file; what is not an image is refused', async () => {
    const { member, workspace, channel } = await room();
    const body = await screenshot(320, 200);
    const key = crypto.randomUUID();
    const first = await post(member, workspace.id, channel.id, body, key);
    const again = await post(member, workspace.id, channel.id, body, key);
    expect(again.json().message.id).toBe(first.json().message.id);
    expect(await history(member, workspace.id, channel.id)).toHaveLength(1);
    expect(chatFiles(workspace.id)).toHaveLength(1);

    const refused = await post(member, workspace.id, channel.id, Buffer.from('not an image'));
    expect(refused.statusCode).toBe(400);
    expect(chatFiles(workspace.id)).toHaveLength(1);
  });

  test('a room in another workspace is a 404', async () => {
    const { member, workspace } = await room();
    const missing = await post(member, workspace.id, crypto.randomUUID(), await screenshot());
    expect(missing.statusCode).toBe(404);
  });

  test('counts toward the workspace’s storage and shows on its author’s profile', async () => {
    const { owner, member, workspace, channel } = await room();
    const { ownerDb } = await getHarness();
    const before = await workspaceStorageUsed(ownerDb, workspace.id);
    const { message } = (await post(member, workspace.id, channel.id, await screenshot())).json();
    expect(await workspaceStorageUsed(ownerDb, workspace.id)).toBeGreaterThan(before);

    const shared = (
      await request(`/workspaces/${workspace.id}/people/${member.id}`, { actor: owner })
    ).json().shared;
    expect(shared).toEqual([
      expect.objectContaining({ id: message.id, channelId: channel.id, issueId: null }),
    ]);
  });
});

describe('a picture’s file goes with', () => {
  test('its message, taken down by its author or an admin', async () => {
    const { owner, member, workspace, channel } = await room();
    const mine = (await post(member, workspace.id, channel.id, await screenshot())).json().message;
    const other = (await post(member, workspace.id, channel.id, await screenshot())).json().message;
    expect(
      (
        await request(`/workspaces/${workspace.id}/messages/${mine.id}`, {
          method: 'DELETE',
          actor: member,
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await request(`/workspaces/${workspace.id}/messages/${other.id}`, {
          method: 'DELETE',
          actor: owner,
        })
      ).statusCode,
    ).toBe(204);
    await runPurges();
    expect(chatFiles(workspace.id)).toEqual([]);
  });

  test('its room, and its workspace', async () => {
    const { owner, workspace } = await room();
    const made = await request(`/workspaces/${workspace.id}/channels`, {
      method: 'POST',
      actor: owner,
      payload: { name: 'design' },
    });
    const design = made.json().channel as { id: string };
    const general = (await request(`/workspaces/${workspace.id}/channels`, { actor: owner }))
      .json()
      .channels.find((c: { name: string }) => c.name === 'general');
    await post(owner, workspace.id, design.id, await screenshot());
    await post(owner, workspace.id, general.id, await screenshot());

    await request(`/workspaces/${workspace.id}/channels/${design.id}`, {
      method: 'DELETE',
      actor: owner,
    });
    await runPurges();
    expect(chatFiles(workspace.id)).toHaveLength(1);

    await request(`/workspaces/${workspace.id}`, {
      method: 'DELETE',
      actor: owner,
      payload: { password: ACTOR_PASSWORD },
    });
    await runPurges();
    expect(chatFiles(workspace.id)).toEqual([]);
  });
});
