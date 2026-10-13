import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import {
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

beforeEach(resetDatabase);
afterAll(closeHarness);

/** A marker no real camera writes, so finding it anywhere means it survived. */
const SECRET = 'TRACE-GPS-52.5200N-13.4050E';

/** A real JPEG carrying EXIF fields, the way a phone photo does. */
async function photoWithMetadata(width = 900, height = 600) {
  return sharp({ create: { width, height, channels: 3, background: '#4f46e5' } })
    .jpeg()
    .withExif({ IFD0: { Artist: SECRET, Copyright: SECRET, ImageDescription: SECRET } })
    .toBuffer();
}

async function upload(actor: Actor, body: Buffer | string, type = 'image/jpeg') {
  const { app } = await getHarness();
  return app.inject({
    method: 'PUT',
    url: '/auth/me/avatar',
    headers: { cookie: actor.cookie, 'content-type': type },
    payload: body,
  });
}

function storedFiles(): string[] {
  try {
    return readdirSync(join(MEDIA_ROOT, 'avatars'));
  } catch {
    return [];
  }
}

describe('uploading a photo', () => {
  test('it is resized to a square and re-encoded, with every byte of metadata gone', async () => {
    const actor = await createActor('Ada');
    const original = await photoWithMetadata();

    // The input really does carry the marker, or the next assertion means nothing.
    expect(original.includes(SECRET)).toBe(true);

    const response = await upload(actor, original);
    expect(response.statusCode).toBe(200);
    expect(response.json().avatar.kind).toBe('photo');

    const served = await request(response.json().avatar.url, { actor });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');

    const bytes = served.rawPayload;
    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe('webp');
    expect([meta.width, meta.height]).toEqual([512, 512]);
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(bytes.includes(SECRET)).toBe(false);
  });

  test('a file that only claims to be an image is refused', async () => {
    const actor = await createActor('Ada');
    const response = await upload(actor, 'not an image at all', 'image/png');

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('unreadable_image');
  });

  test('other kinds of file are refused before anything is decoded', async () => {
    const actor = await createActor('Ada');
    const response = await upload(
      actor,
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
      'image/svg+xml',
    );

    expect(response.statusCode).toBe(415);
  });

  test('an upload past the size limit is refused', async () => {
    const actor = await createActor('Ada');
    const response = await upload(actor, Buffer.alloc(9 * 1024 * 1024, 1));

    expect(response.statusCode).toBe(413);
  });

  test('replacing a photo deletes the old file, not just the reference to it', async () => {
    const actor = await createActor('Ada');
    const before = storedFiles().length;

    await upload(actor, await photoWithMetadata());
    expect(storedFiles().length).toBe(before + 1);

    await upload(actor, await photoWithMetadata(400, 700));
    expect(storedFiles().length).toBe(before + 1);

    // Switching to a generated avatar removes the photo entirely.
    await request('/auth/me/avatar/generated', {
      method: 'PUT',
      actor,
      payload: { seed: 'violet-3' },
    });
    expect(storedFiles().length).toBe(before);
  });

  test('a file whose bytes are not what it claims to be is refused', async () => {
    const actor = await createActor('Ada');
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#000' } })
      .png()
      .toBuffer();

    const response = await upload(actor, png, 'image/jpeg');
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('unreadable_image');
  });

  test('two uploads at once leave exactly one picture on disk', async () => {
    const actor = await createActor('Ada');
    const before = storedFiles().length;

    const results = await Promise.all([
      upload(actor, await photoWithMetadata()),
      upload(actor, await photoWithMetadata(700, 500)),
      upload(actor, await photoWithMetadata(500, 700)),
    ]);

    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(storedFiles().length).toBe(before + 1);
  });

  test('a declared oversize upload is refused before its body is read, signed in or not', async () => {
    const { app } = await getHarness();
    const response = await app.inject({
      method: 'PUT',
      url: '/auth/me/avatar',
      headers: { 'content-type': 'image/jpeg', 'content-length': String(64 * 1024 * 1024) },
      payload: Buffer.alloc(16),
    });

    expect(response.statusCode).toBe(413);
  });

  test('signed out, nothing can be uploaded', async () => {
    const { app } = await getHarness();
    const response = await app.inject({
      method: 'PUT',
      url: '/auth/me/avatar',
      headers: { 'content-type': 'image/jpeg' },
      payload: await photoWithMetadata(),
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('a generated avatar', () => {
  test('is stored as its seed and needs no image request', async () => {
    const actor = await createActor('Ada');
    const response = await request('/auth/me/avatar/generated', {
      method: 'PUT',
      actor,
      payload: { seed: 'teal-7' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().avatar).toEqual({ kind: 'generated', seed: 'teal-7' });

    const me = await request('/auth/me', { actor });
    expect(me.json().user.avatar).toEqual({ kind: 'generated', seed: 'teal-7' });
  });

  test('a seed must be short and plain', async () => {
    const actor = await createActor('Ada');
    for (const seed of ['', 'Has Spaces', 'x'.repeat(33), '<script>']) {
      const response = await request('/auth/me/avatar/generated', {
        method: 'PUT',
        actor,
        payload: { seed },
      });
      expect(response.statusCode).toBe(400);
    }
  });
});

describe('who can see a photo', () => {
  test('until a picture is chosen, the account says so', async () => {
    const actor = await createActor('Ada', { withAvatar: false });
    expect((await request('/auth/me', { actor })).json().user.avatar).toBeNull();
  });

  test('teammates see it, strangers get a 404, and signed-out callers a 401', async () => {
    const ada = await createActor('Ada');
    const teammate = await createActor('Teammate');
    const stranger = await createActor('Stranger');
    const workspace = await createWorkspace(ada);
    await addMember(ada, workspace.id, teammate, 'GUEST');

    const { avatar } = (await upload(ada, await photoWithMetadata())).json();

    expect((await request(avatar.url, { actor: teammate })).statusCode).toBe(200);
    expect((await request(avatar.url, { actor: stranger })).statusCode).toBe(404);
    expect((await request(avatar.url)).statusCode).toBe(401);
  });

  test('the member list carries each member’s avatar', async () => {
    const ada = await createActor('Ada');
    const grace = await createActor('Grace');
    const workspace = await createWorkspace(ada);
    await addMember(ada, workspace.id, grace, 'MEMBER');

    await upload(ada, await photoWithMetadata());
    await request('/auth/me/avatar/generated', {
      method: 'PUT',
      actor: grace,
      payload: { seed: 'amber-2' },
    });

    const members = (await request(`/workspaces/${workspace.id}/members`, { actor: grace })).json()
      .members as { userId: string; avatar: { kind: string; seed?: string } | null }[];

    expect(members.find((m) => m.userId === ada.id)?.avatar?.kind).toBe('photo');
    expect(members.find((m) => m.userId === grace.id)?.avatar).toEqual({
      kind: 'generated',
      seed: 'amber-2',
    });
  });

  test('a photo is not cached by shared caches', async () => {
    const ada = await createActor('Ada');
    const { avatar } = (await upload(ada, await photoWithMetadata())).json();
    const served = await request(avatar.url, { actor: ada });

    expect(served.headers['cache-control']).toContain('private');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('the picture gate holds on the server', () => {
  test('a member without a picture is told why, and a stranger still learns nothing', async () => {
    const owner = await createActor('Owner');
    const newcomer = await createActor('Newcomer', { withAvatar: false });
    const stranger = await createActor('Stranger', { withAvatar: false });
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id, newcomer, 'MEMBER');

    const asNewcomer = await request(`/workspaces/${workspace.id}/projects`, { actor: newcomer });
    expect(asNewcomer.statusCode).toBe(403);
    expect(asNewcomer.json().error).toBe('avatar_required');

    const asStranger = await request(`/workspaces/${workspace.id}/projects`, { actor: stranger });
    expect(asStranger.statusCode).toBe(404);
  });

  test('creating a workspace needs a picture too', async () => {
    const newcomer = await createActor('Newcomer', { withAvatar: false });
    const response = await request('/workspaces', {
      method: 'POST',
      actor: newcomer,
      payload: { name: 'Mine' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('avatar_required');
  });

  test('choosing a picture opens the door at once', async () => {
    const owner = await createActor('Owner');
    const newcomer = await createActor('Newcomer', { withAvatar: false });
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id, newcomer, 'MEMBER');

    await request('/auth/me/avatar/generated', {
      method: 'PUT',
      actor: newcomer,
      payload: { seed: 'first-pick' },
    });

    const response = await request(`/workspaces/${workspace.id}/projects`, { actor: newcomer });
    expect(response.statusCode).toBe(200);
  });

  test('account routes stay open, so the picture can be chosen at all', async () => {
    const newcomer = await createActor('Newcomer', { withAvatar: false });

    expect((await request('/auth/me', { actor: newcomer })).statusCode).toBe(200);
    expect(
      (
        await request('/auth/me/avatar/generated', {
          method: 'PUT',
          actor: newcomer,
          payload: { seed: 'ok-1' },
        })
      ).statusCode,
    ).toBe(200);
  });

  test('the workspace list and notifications, which show workspace content, are gated too', async () => {
    const newcomer = await createActor('Newcomer', { withAvatar: false });

    for (const path of ['/workspaces', '/notifications']) {
      const response = await request(path, { actor: newcomer });
      expect(response.statusCode).toBe(403);
      expect(response.json().error).toBe('avatar_required');
    }
  });

  test('leaving a workspace never needs a picture', async () => {
    const owner = await createActor('Owner');
    const newcomer = await createActor('Newcomer', { withAvatar: false });
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id, newcomer, 'MEMBER');

    const response = await request(`/workspaces/${workspace.id}/members/me`, {
      method: 'DELETE',
      actor: newcomer,
    });

    expect(response.statusCode).toBe(204);
  });
});
