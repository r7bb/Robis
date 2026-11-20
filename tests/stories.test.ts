import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { auditEvents, STORY_EXPIRY_JOB, stories } from '@robis/database';
import { MAX_LIVE_STORIES } from '@robis/shared';
import { localDiskStorage } from '@robis/storage';
import { handlers } from '@robis/worker/handlers';
import { Runner } from '@robis/worker/runner';
import { storagePurgeHandler } from '@robis/worker/storage-purge';
import { asc, eq } from 'drizzle-orm';
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
 * Stories (B2). Done when: an expired story's file is gone from storage, a
 * story made offline uploads exactly once, and turning stories off hides
 * them and refuses them in the API. Plus the rest a workspace route owes:
 * 404 outside, 403 without the permission, audited, and live as ids only.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

/** A marker no real camera writes, so finding it anywhere means it survived. */
const SECRET = 'LOCATION-51.5007N-0.1246W';

function photo() {
  return sharp({ create: { width: 1080, height: 1920, channels: 3, background: '#f97316' } })
    .jpeg()
    .withExif({ IFD0: { Artist: SECRET } })
    .toBuffer();
}

async function postPhoto(actor: Actor, workspaceId: string, body: Buffer, key?: string) {
  const { app } = await getHarness();
  return app.inject({
    method: 'POST',
    url: `/workspaces/${workspaceId}/stories/photo`,
    headers: {
      cookie: actor.cookie,
      'content-type': 'image/jpeg',
      ...(key ? { 'idempotency-key': key } : {}),
    },
    payload: body,
  });
}

function postText(actor: Actor, workspaceId: string, body = 'Shipping the new board today') {
  return request(`/workspaces/${workspaceId}/stories`, {
    method: 'POST',
    actor,
    payload: { body, tone: 'sea' },
  });
}

function storyFiles(workspaceId: string): string[] {
  try {
    return readdirSync(join(MEDIA_ROOT, 'stories', workspaceId));
  } catch {
    return [];
  }
}

/** An audit payload as stored: the JSON text its hash covers. */
const payloadOf = (stored: unknown) =>
  (typeof stored === 'string' ? JSON.parse(stored) : stored) as Record<string, unknown>;

/** Age every story in the workspace past its 24 hours, as the clock would. */
async function ageStories(workspaceId: string) {
  const { ownerDb } = await getHarness();
  await ownerDb
    .update(stories)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(stories.workspaceId, workspaceId));
}

/** The expiry job and then the file purges it queued, as the worker runs them. */
async function runExpiry() {
  const { workerDb: db } = await getHarness();
  const runner = new Runner({
    db,
    handlers: {
      [STORY_EXPIRY_JOB]: handlers[STORY_EXPIRY_JOB]!,
      'storage.purge': storagePurgeHandler(localDiskStorage(MEDIA_ROOT)),
    },
  });
  await handlers[STORY_EXPIRY_JOB]!({}, { db });
  await runner.tick();
}

async function team() {
  const owner = await createActor('Owner');
  const member = await createActor('Member');
  const workspace = await createWorkspace(owner);
  await addMember(owner, workspace.id, member, 'MEMBER');
  return { owner, member, workspace };
}

describe('posting a story', () => {
  test('a photo is stored without its metadata and shown to members, as an image route', async () => {
    const { owner, member, workspace } = await team();
    const original = await photo();
    expect(original.includes(SECRET)).toBe(true);

    const posted = await postPhoto(member, workspace.id, original);
    expect(posted.statusCode).toBe(201);
    const { story } = posted.json();
    expect(story).toMatchObject({ kind: 'photo', authorId: member.id, body: null });
    expect(story.url).toBe(`/workspaces/${workspace.id}/stories/${story.id}/image`);
    const hours = (Date.parse(story.expiresAt) - Date.parse(story.createdAt)) / 3_600_000;
    expect(hours).toBeCloseTo(24, 3);

    const listed = (await request(`/workspaces/${workspace.id}/stories`, { actor: owner })).json();
    expect(listed.stories.map((s: { id: string }) => s.id)).toEqual([story.id]);

    const { app } = await getHarness();
    const served = await app.inject({
      method: 'GET',
      url: story.url,
      headers: { cookie: owner.cookie },
    });
    expect(served.statusCode).toBe(200);
    expect(served.headers['cache-control']).toMatch(/^private/);
    expect(served.rawPayload.includes(SECRET)).toBe(false);
    expect((await sharp(served.rawPayload).metadata()).exif).toBeUndefined();
  });

  test('a text story keeps its words out of the audit trail', async () => {
    const { member, workspace } = await team();
    const posted = await postText(member, workspace.id, 'A private thought about Friday');
    expect(posted.statusCode).toBe(201);
    expect(posted.json().story).toMatchObject({ kind: 'text', tone: 'sea', url: null });

    const { ownerDb } = await getHarness();
    const [event] = await ownerDb
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.eventType, 'story.added'));
    expect(event).toBeTruthy();
    expect(JSON.stringify(event!.payload)).not.toContain('Friday');
  });

  test('outside the workspace is 404; a guest may look but not post', async () => {
    const { owner, workspace } = await team();
    const stranger = await createActor('Stranger');
    const guest = await createActor('Guest');
    await addMember(owner, workspace.id, guest, 'GUEST');
    const { story } = (await postText(owner, workspace.id)).json();

    expect(
      (await request(`/workspaces/${workspace.id}/stories`, { actor: stranger })).statusCode,
    ).toBe(404);
    expect((await postText(stranger, workspace.id)).statusCode).toBe(404);
    const { app } = await getHarness();
    const image = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspace.id}/stories/${story.id}/image`,
      headers: { cookie: stranger.cookie },
    });
    expect(image.statusCode).toBe(404);

    expect(
      (await request(`/workspaces/${workspace.id}/stories`, { actor: guest })).statusCode,
    ).toBe(200);
    expect((await postText(guest, workspace.id)).statusCode).toBe(403);
    expect((await postPhoto(guest, workspace.id, await photo())).statusCode).toBe(403);
  });

  test(`stops at ${MAX_LIVE_STORIES} showing at once for one person`, async () => {
    const { member, workspace } = await team();
    for (let i = 0; i < MAX_LIVE_STORIES; i++) {
      expect((await postText(member, workspace.id, `Update ${i}`)).statusCode).toBe(201);
    }
    const refused = await postText(member, workspace.id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe('too_many_stories');
  });

  test('refuses what is not a story: too long, an unknown tone, a file that is not an image', async () => {
    const { member, workspace } = await team();
    const long = await request(`/workspaces/${workspace.id}/stories`, {
      method: 'POST',
      actor: member,
      payload: { body: 'x'.repeat(281), tone: 'sea' },
    });
    expect(long.statusCode).toBe(400);
    const tone = await request(`/workspaces/${workspace.id}/stories`, {
      method: 'POST',
      actor: member,
      payload: { body: 'Hello', tone: 'neon' },
    });
    expect(tone.statusCode).toBe(400);
    const notImage = await postPhoto(member, workspace.id, Buffer.from('not an image at all'));
    expect(notImage.statusCode).toBe(400);
    expect(storyFiles(workspace.id)).toEqual([]);
  });
});

describe('a story made offline', () => {
  test('uploads exactly once, however many times the phone replays it', async () => {
    const { member, workspace } = await team();
    const body = await photo();
    const key = crypto.randomUUID();

    const first = await postPhoto(member, workspace.id, body, key);
    const again = await postPhoto(member, workspace.id, body, key);
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(201);
    expect(again.json().story.id).toBe(first.json().story.id);

    const listed = (await request(`/workspaces/${workspace.id}/stories`, { actor: member })).json();
    expect(listed.stories).toHaveLength(1);
    expect(storyFiles(workspace.id)).toHaveLength(1);

    // The same key with other bytes is a different upload, and refused.
    const other = await sharp({
      create: { width: 40, height: 40, channels: 3, background: '#000' },
    })
      .jpeg()
      .toBuffer();
    expect((await postPhoto(member, workspace.id, other, key)).statusCode).toBe(409);
  });
});

describe('a story past its 24 hours', () => {
  test('is a 404 at once, before the job runs, and the job removes the row and the file', async () => {
    const { owner, member, workspace } = await team();
    const { story } = (await postPhoto(member, workspace.id, await photo())).json();
    expect(storyFiles(workspace.id)).toHaveLength(1);

    await ageStories(workspace.id);
    const { app, ownerDb } = await getHarness();
    // Not deleted yet, already gone to everyone.
    expect(await ownerDb.select().from(stories).where(eq(stories.id, story.id))).toHaveLength(1);
    const listed = (await request(`/workspaces/${workspace.id}/stories`, { actor: owner })).json();
    expect(listed.stories).toEqual([]);
    const image = await app.inject({
      method: 'GET',
      url: story.url,
      headers: { cookie: owner.cookie },
    });
    expect(image.statusCode).toBe(404);
    const removed = await request(`/workspaces/${workspace.id}/stories/${story.id}`, {
      method: 'DELETE',
      actor: member,
    });
    expect(removed.statusCode).toBe(404);

    await runExpiry();
    expect(await ownerDb.select().from(stories).where(eq(stories.id, story.id))).toHaveLength(0);
    expect(storyFiles(workspace.id)).toEqual([]);
  });

  test('leaves stories still within their 24 hours alone', async () => {
    const { member, workspace } = await team();
    await postPhoto(member, workspace.id, await photo());
    await runExpiry();
    const listed = (await request(`/workspaces/${workspace.id}/stories`, { actor: member })).json();
    expect(listed.stories).toHaveLength(1);
    expect(storyFiles(workspace.id)).toHaveLength(1);
  });
});

describe('taking a story down', () => {
  test('its author can, an admin can, another member cannot; the file goes and it is audited', async () => {
    const { owner, member, workspace } = await team();
    const other = await createActor('Other');
    await addMember(owner, workspace.id, other, 'MEMBER');
    const mine = (await postPhoto(member, workspace.id, await photo())).json().story;
    const second = (await postText(member, workspace.id)).json().story;

    const notTheirs = await request(`/workspaces/${workspace.id}/stories/${mine.id}`, {
      method: 'DELETE',
      actor: other,
    });
    expect(notTheirs.statusCode).toBe(403);

    const own = await request(`/workspaces/${workspace.id}/stories/${mine.id}`, {
      method: 'DELETE',
      actor: member,
    });
    expect(own.statusCode).toBe(204);
    const moderated = await request(`/workspaces/${workspace.id}/stories/${second.id}`, {
      method: 'DELETE',
      actor: owner,
    });
    expect(moderated.statusCode).toBe(204);

    await runExpiry();
    expect(storyFiles(workspace.id)).toEqual([]);
    const { ownerDb } = await getHarness();
    const deletions = await ownerDb
      .select({ payload: auditEvents.payload })
      .from(auditEvents)
      .where(eq(auditEvents.eventType, 'story.deleted'));
    expect(deletions.map((d) => payloadOf(d.payload).moderated).sort()).toEqual([false, true]);
  });
});

describe('turning stories off', () => {
  test('is the owner’s alone, hides what there is, refuses new ones, and is audited', async () => {
    const { owner, member, workspace } = await team();
    const admin = await createActor('Admin');
    await addMember(owner, workspace.id, admin, 'ADMIN');
    const { story } = (await postPhoto(member, workspace.id, await photo())).json();

    const toggle = (actor: Actor, enabled: boolean) =>
      request(`/workspaces/${workspace.id}/stories-enabled`, {
        method: 'PUT',
        actor,
        payload: { enabled },
      });
    expect((await toggle(admin, false)).statusCode).toBe(403);
    const off = await toggle(owner, false);
    expect(off.statusCode).toBe(200);
    expect(off.json().storiesEnabled).toBe(false);

    const listed = await request(`/workspaces/${workspace.id}/stories`, { actor: member });
    expect(listed.statusCode).toBe(409);
    expect(listed.json().error).toBe('stories_off');
    expect((await postText(member, workspace.id)).statusCode).toBe(409);
    expect((await postPhoto(member, workspace.id, await photo())).statusCode).toBe(409);
    const { app } = await getHarness();
    const image = await app.inject({
      method: 'GET',
      url: story.url,
      headers: { cookie: member.cookie },
    });
    expect(image.statusCode).toBe(404);

    const shown = await request(`/workspaces/${workspace.id}`, { actor: member });
    expect(shown.json().workspace.storiesEnabled).toBe(false);

    // Back on within the day, what was there is there again.
    expect((await toggle(owner, true)).statusCode).toBe(200);
    const back = (await request(`/workspaces/${workspace.id}/stories`, { actor: member })).json();
    expect(back.stories.map((s: { id: string }) => s.id)).toEqual([story.id]);

    const { ownerDb } = await getHarness();
    const switched = await ownerDb
      .select({ payload: auditEvents.payload })
      .from(auditEvents)
      .where(eq(auditEvents.eventType, 'workspace.stories_enabled'))
      .orderBy(asc(auditEvents.seq));
    expect(switched.map((s) => payloadOf(s.payload))).toEqual([
      { enabled: false },
      { enabled: true },
    ]);
  });
});

describe('reviewed edges', () => {
  test('an admin can take a story down with stories off; moderation never waits', async () => {
    const { owner, member, workspace } = await team();
    const { story } = (await postText(member, workspace.id)).json();
    await request(`/workspaces/${workspace.id}/stories-enabled`, {
      method: 'PUT',
      actor: owner,
      payload: { enabled: false },
    });
    const down = await request(`/workspaces/${workspace.id}/stories/${story.id}`, {
      method: 'DELETE',
      actor: owner,
    });
    expect(down.statusCode).toBe(204);
  });

  test('a photo is refused before it is read with stories off or the cap reached', async () => {
    const { owner, member, workspace } = await team();
    for (let i = 0; i < MAX_LIVE_STORIES; i++) await postText(member, workspace.id, `Update ${i}`);
    const capped = await postPhoto(member, workspace.id, await photo());
    expect(capped.statusCode).toBe(409);
    expect(capped.json().error).toBe('too_many_stories');
    await request(`/workspaces/${workspace.id}/stories-enabled`, {
      method: 'PUT',
      actor: owner,
      payload: { enabled: false },
    });
    const off = await postPhoto(owner, workspace.id, await photo());
    expect(off.json().error).toBe('stories_off');
    expect(storyFiles(workspace.id)).toEqual([]);
  });

  test('the image is asked for again on every view, so a taken-down story stops showing', async () => {
    const { owner, member, workspace } = await team();
    const { story } = (await postPhoto(member, workspace.id, await photo())).json();
    const { app } = await getHarness();
    const first = await app.inject({
      method: 'GET',
      url: story.url,
      headers: { cookie: owner.cookie },
    });
    expect(first.headers['cache-control']).toBe('private, no-cache');
    const etag = String(first.headers.etag);
    const again = await app.inject({
      method: 'GET',
      url: story.url,
      headers: { cookie: owner.cookie, 'if-none-match': etag },
    });
    expect(again.statusCode).toBe(304);

    await request(`/workspaces/${workspace.id}/stories/${story.id}`, {
      method: 'DELETE',
      actor: member,
    });
    const after = await app.inject({
      method: 'GET',
      url: story.url,
      headers: { cookie: owner.cookie, 'if-none-match': etag },
    });
    expect(after.statusCode).toBe(404);
  });

  test("a member's stories go when they leave or are removed, files and all", async () => {
    const { owner, member, workspace } = await team();
    const other = await createActor('Other');
    await addMember(owner, workspace.id, other, 'MEMBER');
    await postPhoto(member, workspace.id, await photo());
    await postPhoto(other, workspace.id, await photo());
    await postText(owner, workspace.id);

    expect(
      (await request(`/workspaces/${workspace.id}/members/me`, { method: 'DELETE', actor: member }))
        .statusCode,
    ).toBe(204);
    expect(
      (
        await request(`/workspaces/${workspace.id}/members/${other.id}`, {
          method: 'DELETE',
          actor: owner,
        })
      ).statusCode,
    ).toBe(204);

    await runExpiry();
    expect(storyFiles(workspace.id)).toEqual([]);
    const listed = (await request(`/workspaces/${workspace.id}/stories`, { actor: owner })).json();
    expect(listed.stories.map((s: { authorId: string }) => s.authorId)).toEqual([owner.id]);
  });
});

describe('when the place goes', () => {
  test('deleting the workspace removes its story files', async () => {
    const { owner, member, workspace } = await team();
    await postPhoto(member, workspace.id, await photo());
    const deleted = await request(`/workspaces/${workspace.id}`, {
      method: 'DELETE',
      actor: owner,
      payload: { password: ACTOR_PASSWORD },
    });
    expect(deleted.statusCode).toBe(204);
    await runExpiry();
    expect(storyFiles(workspace.id)).toEqual([]);
  });

  test("deleting an account removes that person's stories and their files", async () => {
    const { owner, member, workspace } = await team();
    await postPhoto(member, workspace.id, await photo());
    await postText(owner, workspace.id);
    const gone = await request('/auth/me', {
      method: 'DELETE',
      actor: member,
      payload: { password: ACTOR_PASSWORD, workspaces: [] },
    });
    expect(gone.statusCode).toBe(204);
    await runExpiry();
    expect(storyFiles(workspace.id)).toEqual([]);
    const listed = (await request(`/workspaces/${workspace.id}/stories`, { actor: owner })).json();
    expect(listed.stories.map((s: { authorId: string }) => s.authorId)).toEqual([owner.id]);
  });
});
