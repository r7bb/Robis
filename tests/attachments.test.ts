import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { localDiskStorage } from '@robis/api/media/storage';
import { auditEvents, enqueue, jobs, verifyAuditChain } from '@robis/database';
import { Runner } from '@robis/worker/runner';
import { storagePurgeHandler } from '@robis/worker/storage-purge';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import {
  type Actor,
  addMember,
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  getHarness,
  MEDIA_ROOT,
  request,
  resetDatabase,
} from './harness.ts';

beforeEach(resetDatabase);
afterAll(closeHarness);

/** A marker no real camera writes, so finding it anywhere means it survived. */
const SECRET = 'LOCATION-48.8584N-2.2945E';

async function photo(format: 'jpeg' | 'png' = 'jpeg', width = 1200, height = 800) {
  const base = sharp({ create: { width, height, channels: 3, background: '#0ea5e9' } });
  return (format === 'png' ? base.png() : base.jpeg())
    .withExif({ IFD0: { Artist: SECRET, ImageDescription: SECRET } })
    .toBuffer();
}

async function attach(
  actor: Actor,
  workspaceId: string,
  issueId: string,
  body: Buffer,
  options: { type?: string; key?: string; commentId?: string } = {},
) {
  const { app } = await getHarness();
  return app.inject({
    method: 'POST',
    url: `/workspaces/${workspaceId}/issues/${issueId}/attachments${
      options.commentId ? `?commentId=${options.commentId}` : ''
    }`,
    headers: {
      cookie: actor.cookie,
      'content-type': options.type ?? 'image/jpeg',
      ...(options.key ? { 'idempotency-key': options.key } : {}),
    },
    payload: body,
  });
}

function filesFor(workspaceId: string): string[] {
  try {
    return readdirSync(join(MEDIA_ROOT, 'attachments', workspaceId));
  } catch {
    return [];
  }
}

async function issueSetup() {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const project = await createProject(owner, workspace.id);
  const created = await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
    method: 'POST',
    actor: owner,
    payload: { title: 'Broken header on Safari' },
  });
  return { owner, workspace, project, issue: created.json().issue as { id: string } };
}

/** Run every due storage purge job, the way the worker would. */
async function runPurges() {
  const { db } = await getHarness();
  const runner = new Runner({
    db,
    handlers: { 'storage.purge': storagePurgeHandler(localDiskStorage(MEDIA_ROOT)) },
  });
  return runner.tick();
}

describe('attaching an image', () => {
  test('a photo is stored without its metadata, and listed and served to members', async () => {
    const { owner, workspace, issue } = await issueSetup();
    const original = await photo('jpeg');
    expect(original.includes(SECRET)).toBe(true);

    const response = await attach(owner, workspace.id, issue.id, original);
    expect(response.statusCode).toBe(201);
    const { attachment } = response.json();
    expect(attachment).toMatchObject({ contentType: 'image/webp', width: 1200, height: 800 });

    const listed = await request(`/workspaces/${workspace.id}/issues/${issue.id}/attachments`, {
      actor: owner,
    });
    expect(listed.json().attachments.map((a: { id: string }) => a.id)).toEqual([attachment.id]);

    const served = await request(attachment.url, { actor: owner });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.rawPayload.includes(SECRET)).toBe(false);
    expect((await sharp(served.rawPayload).metadata()).exif).toBeUndefined();
  });

  test('a screenshot stays a lossless PNG, and a large one is scaled down, not up', async () => {
    const { owner, workspace, issue } = await issueSetup();

    const big = await attach(owner, workspace.id, issue.id, await photo('png', 4000, 2000), {
      type: 'image/png',
    });
    expect(big.json().attachment).toMatchObject({
      contentType: 'image/png',
      width: 2560,
      height: 1280,
    });

    const small = await attach(owner, workspace.id, issue.id, await photo('png', 300, 200), {
      type: 'image/png',
    });
    expect(small.json().attachment).toMatchObject({ width: 300, height: 200 });
  });

  test('refused: not an image, the wrong declared type, too large, signed out', async () => {
    const { owner, workspace, issue } = await issueSetup();
    const { app } = await getHarness();

    const notImage = await attach(owner, workspace.id, issue.id, Buffer.from('plain words'), {
      type: 'image/png',
    });
    expect(notImage.statusCode).toBe(400);

    const mislabelled = await attach(owner, workspace.id, issue.id, await photo('png'), {
      type: 'image/jpeg',
    });
    expect(mislabelled.statusCode).toBe(400);

    const huge = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspace.id}/issues/${issue.id}/attachments`,
      headers: { cookie: owner.cookie, 'content-type': 'image/jpeg' },
      payload: Buffer.alloc(9 * 1024 * 1024, 1),
    });
    expect(huge.statusCode).toBe(413);

    const anonymous = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspace.id}/issues/${issue.id}/attachments`,
      headers: { 'content-type': 'image/jpeg' },
      payload: await photo(),
    });
    expect(anonymous.statusCode).toBe(401);
  });
});

describe('who can reach an attachment', () => {
  test('a non-member gets a 404 for a valid attachment id, exactly like a missing one', async () => {
    const { owner, workspace, issue } = await issueSetup();
    const stranger = await createActor('Stranger');
    const { attachment } = (await attach(owner, workspace.id, issue.id, await photo())).json();

    const valid = await request(attachment.url, { actor: stranger });
    const missing = await request(
      `/workspaces/${workspace.id}/attachments/00000000-0000-0000-0000-000000000000`,
      { actor: stranger },
    );

    expect(valid.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(valid.body).toBe(missing.body);
  });

  test('an id from another workspace is not found through this one', async () => {
    const first = await issueSetup();
    const second = await issueSetup();
    await addMember(second.owner, second.workspace.id, first.owner, 'MEMBER');
    const { attachment } = (
      await attach(second.owner, second.workspace.id, second.issue.id, await photo())
    ).json();

    const crossed = await request(
      `/workspaces/${first.workspace.id}/attachments/${attachment.id}`,
      {
        actor: first.owner,
      },
    );
    expect(crossed.statusCode).toBe(404);
  });

  test('a guest can attach to their own comment, but not to anyone else’s', async () => {
    const { owner, workspace, issue } = await issueSetup();
    const guest = await createActor('Guest');
    await addMember(owner, workspace.id, guest, 'GUEST');

    const mine = await request(`/workspaces/${workspace.id}/issues/${issue.id}/comments`, {
      method: 'POST',
      actor: guest,
      payload: { body: 'Here is what I see' },
    });
    const theirs = await request(`/workspaces/${workspace.id}/issues/${issue.id}/comments`, {
      method: 'POST',
      actor: owner,
      payload: { body: 'Thanks' },
    });

    const onMine = await attach(guest, workspace.id, issue.id, await photo(), {
      commentId: mine.json().comment.id,
    });
    const onTheirs = await attach(guest, workspace.id, issue.id, await photo(), {
      commentId: theirs.json().comment.id,
    });

    expect(onMine.statusCode).toBe(201);
    expect(onMine.json().attachment.commentId).toBe(mine.json().comment.id);
    expect(onTheirs.statusCode).toBe(403);
  });

  test('members delete their own; only admins delete anyone’s', async () => {
    const { owner, workspace, issue } = await issueSetup();
    const member = await createActor('Member');
    await addMember(owner, workspace.id, member, 'MEMBER');

    const byOwner = (await attach(owner, workspace.id, issue.id, await photo())).json().attachment;
    const byMember = (await attach(member, workspace.id, issue.id, await photo())).json()
      .attachment;

    const memberOnOwners = await request(byOwner.url, { method: 'DELETE', actor: member });
    expect(memberOnOwners.statusCode).toBe(403);

    const memberOnOwn = await request(byMember.url, { method: 'DELETE', actor: member });
    expect(memberOnOwn.statusCode).toBe(204);

    const ownerModerates = await request(byOwner.url, { method: 'DELETE', actor: owner });
    expect(ownerModerates.statusCode).toBe(204);

    // Removal is a queued job, so it survives storage being briefly down.
    await runPurges();
    expect(filesFor(workspace.id)).toEqual([]);
  });
});

describe('uploads from a phone that was offline', () => {
  test('a replayed upload returns the first one and stores one file', async () => {
    const { owner, workspace, issue } = await issueSetup();
    const bytes = await photo();

    const first = await attach(owner, workspace.id, issue.id, bytes, { key: 'offline-photo-1' });
    const replay = await attach(owner, workspace.id, issue.id, bytes, { key: 'offline-photo-1' });

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json().attachment.id).toBe(first.json().attachment.id);
    expect(filesFor(workspace.id)).toHaveLength(1);
  });

  test('the same key with a different picture is refused, not mistaken for a replay', async () => {
    const { owner, workspace, issue } = await issueSetup();

    await attach(owner, workspace.id, issue.id, await photo('jpeg', 800, 600), { key: 'k-1' });
    const different = await attach(owner, workspace.id, issue.id, await photo('jpeg', 600, 800), {
      key: 'k-1',
    });

    expect(different.statusCode).toBe(409);
    expect(different.json().error).toBe('idempotency_mismatch');
  });
});

describe('files follow their rows', () => {
  test('deleting an issue queues a job that removes its files', async () => {
    const { db } = await getHarness();
    const { owner, workspace, issue } = await issueSetup();
    await attach(owner, workspace.id, issue.id, await photo());
    await attach(owner, workspace.id, issue.id, await photo('png'), { type: 'image/png' });
    expect(filesFor(workspace.id)).toHaveLength(2);

    await request(`/workspaces/${workspace.id}/issues/${issue.id}`, {
      method: 'DELETE',
      actor: owner,
    });

    const queued = await db.select().from(jobs).where(eq(jobs.kind, 'storage.purge'));
    expect(queued).toHaveLength(1);

    expect((await runPurges()).completed).toBe(1);
    expect(filesFor(workspace.id)).toEqual([]);
  });

  test('deleting a comment removes its attachments, and the issue keeps its own', async () => {
    const { owner, workspace, issue } = await issueSetup();
    const comment = await request(`/workspaces/${workspace.id}/issues/${issue.id}/comments`, {
      method: 'POST',
      actor: owner,
      payload: { body: 'Screenshot attached' },
    });
    await attach(owner, workspace.id, issue.id, await photo());
    await attach(owner, workspace.id, issue.id, await photo(), {
      commentId: comment.json().comment.id,
    });

    await request(`/workspaces/${workspace.id}/comments/${comment.json().comment.id}`, {
      method: 'DELETE',
      actor: owner,
    });
    await runPurges();

    expect(filesFor(workspace.id)).toHaveLength(1);
    const left = await request(`/workspaces/${workspace.id}/issues/${issue.id}/attachments`, {
      actor: owner,
    });
    expect(left.json().attachments).toHaveLength(1);
  });

  test('deleting a project removes the files of every issue in it', async () => {
    const { owner, workspace, project, issue } = await issueSetup();
    await attach(owner, workspace.id, issue.id, await photo());
    await attach(owner, workspace.id, issue.id, await photo('png'), { type: 'image/png' });

    const deleted = await request(`/workspaces/${workspace.id}/projects/${project.id}`, {
      method: 'DELETE',
      actor: owner,
    });
    expect(deleted.statusCode).toBe(204);

    await runPurges();
    expect(filesFor(workspace.id)).toEqual([]);
  });

  test('deleting a workspace removes every file it held', async () => {
    const { owner, workspace, issue } = await issueSetup();
    await attach(owner, workspace.id, issue.id, await photo());

    await request(`/workspaces/${workspace.id}`, { method: 'DELETE', actor: owner });
    await runPurges();

    expect(filesFor(workspace.id)).toEqual([]);
  });

  test('a purge run twice is harmless', async () => {
    const { db } = await getHarness();
    await enqueue(db, 'storage.purge', { keys: ['attachments/ws/never-there.png'] });
    await enqueue(db, 'storage.purge', { keys: ['attachments/ws/never-there.png'] });

    expect((await runPurges()).completed).toBe(2);
  });
});

describe('the audit trail', () => {
  test('adding and removing an attachment are recorded, and the chain holds', async () => {
    const { db } = await getHarness();
    const { owner, workspace, issue } = await issueSetup();
    const { attachment } = (await attach(owner, workspace.id, issue.id, await photo())).json();
    await request(attachment.url, { method: 'DELETE', actor: owner });

    const types = (
      await db
        .select({ type: auditEvents.eventType })
        .from(auditEvents)
        .where(eq(auditEvents.workspaceId, workspace.id))
    ).map((row) => row.type);

    expect(types).toContain('attachment.added');
    expect(types).toContain('attachment.deleted');
    expect((await verifyAuditChain(db, workspace.id)).ok).toBe(true);
  });
});
