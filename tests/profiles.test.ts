import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { auditEvents, workspaceMembers } from '@robis/database';
import { localDiskStorage } from '@robis/storage';
import { Runner } from '@robis/worker/runner';
import { storagePurgeHandler } from '@robis/worker/storage-purge';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import {
  ACTOR_PASSWORD,
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

/**
 * Profiles (B2): a person as their workspace knows them. Done when: inside
 * the workspace only (404 outside, and for someone who is not a member);
 * your own to edit; activity only of the kinds the viewer may read, never
 * membership, settings or anything personal; a grid of the images they
 * shared; and a cover that is stripped, members-only and removed with the
 * membership.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const SECRET = 'LOCATION-55.9533N-3.1883W';

function photo() {
  return sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#14b8a6' } })
    .jpeg()
    .withExif({ IFD0: { Artist: SECRET } })
    .toBuffer();
}

async function setCover(actor: Actor, workspaceId: string, body: Buffer) {
  const { app } = await getHarness();
  return app.inject({
    method: 'PUT',
    url: `/workspaces/${workspaceId}/people/me/cover`,
    headers: { cookie: actor.cookie, 'content-type': 'image/jpeg' },
    payload: body,
  });
}

async function fetchImage(actor: Actor, url: string) {
  const { app } = await getHarness();
  return app.inject({ method: 'GET', url, headers: { cookie: actor.cookie } });
}

function coverFiles(workspaceId: string): string[] {
  try {
    return readdirSync(join(MEDIA_ROOT, 'covers', workspaceId));
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

const profileOf = (viewer: Actor, workspaceId: string, userId: string) =>
  request(`/workspaces/${workspaceId}/people/${userId}`, { actor: viewer });

async function team() {
  const owner = await createActor('Owner');
  const member = await createActor('Member');
  const workspace = await createWorkspace(owner);
  await addMember(owner, workspace.id, member, 'MEMBER');
  return { owner, member, workspace };
}

describe('a profile', () => {
  test('shows a member as the workspace knows them', async () => {
    const { owner, member, workspace } = await team();
    const shown = await profileOf(owner, workspace.id, member.id);
    expect(shown.statusCode).toBe(200);
    expect(shown.json().profile).toMatchObject({
      userId: member.id,
      role: 'MEMBER',
      title: null,
      workingOn: null,
      cover: null,
    });
  });

  test('is a 404 outside the workspace, and for someone who is not a member of it', async () => {
    const { owner, member, workspace } = await team();
    const stranger = await createActor('Stranger');
    expect((await profileOf(stranger, workspace.id, member.id)).statusCode).toBe(404);
    expect((await profileOf(owner, workspace.id, stranger.id)).statusCode).toBe(404);
    expect((await profileOf(owner, workspace.id, 'not-an-id')).statusCode).toBe(404);
  });

  test('is yours to edit: trimmed, cleared with nothing, too long refused, audited without the words', async () => {
    const { owner, member, workspace } = await team();
    const edit = (payload: unknown) =>
      request(`/workspaces/${workspace.id}/people/me`, { method: 'PATCH', actor: member, payload });

    const saved = await edit({ title: '  Design lead ', workingOn: 'The new onboarding' });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().profile).toMatchObject({
      title: 'Design lead',
      workingOn: 'The new onboarding',
    });
    expect((await profileOf(owner, workspace.id, member.id)).json().profile.title).toBe(
      'Design lead',
    );

    expect((await edit({ workingOn: '' })).json().profile.workingOn).toBeNull();
    expect((await edit({ title: 'x'.repeat(61) })).statusCode).toBe(400);
    expect((await edit({})).statusCode).toBe(400);

    const { ownerDb } = await getHarness();
    const events = await ownerDb
      .select({ payload: auditEvents.payload })
      .from(auditEvents)
      .where(eq(auditEvents.eventType, 'member.profile_updated'));
    expect(events.length).toBe(2);
    expect(events.map((e) => e.payload).join(' ')).not.toContain('onboarding');
  });

  test('is per workspace: a title in one is not a title in another', async () => {
    const { owner, member, workspace } = await team();
    const other = await createWorkspace(owner, 'Other');
    await addMember(owner, other.id, member, 'MEMBER');
    await request(`/workspaces/${workspace.id}/people/me`, {
      method: 'PATCH',
      actor: member,
      payload: { title: 'Backend' },
    });
    expect((await profileOf(owner, other.id, member.id)).json().profile.title).toBeNull();
  });
});

describe('recent activity on a profile', () => {
  test('shows their work, and never membership, settings or what is theirs alone', async () => {
    const { owner, member, workspace } = await team();
    const guest = await createActor('Guest');
    await addMember(owner, workspace.id, guest, 'GUEST');
    const project = await createProject(owner, workspace.id);
    const issue = (
      await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
        method: 'POST',
        actor: owner,
        payload: { title: 'Broken header' },
      })
    ).json().issue;
    await request(`/workspaces/${workspace.id}/issues/${issue.id}/comments`, {
      method: 'POST',
      actor: owner,
      payload: { body: 'Looking now' },
    });
    // Theirs alone, and an admin's business: neither belongs on a profile.
    await request(`/workspaces/${workspace.id}/projects/${project.id}/views`, {
      method: 'POST',
      actor: owner,
      payload: { name: 'Mine', filter: { status: 'TODO' } },
    });
    await request(`/workspaces/${workspace.id}/members/${guest.id}`, {
      method: 'PATCH',
      actor: owner,
      payload: { role: 'MEMBER' },
    });
    await request(`/workspaces/${workspace.id}/stories`, {
      method: 'POST',
      actor: owner,
      payload: { body: 'Hello', tone: 'sea' },
    });

    const types = async (viewer: Actor) =>
      ((await profileOf(viewer, workspace.id, owner.id)).json().activity as { eventType: string }[])
        .map((e) => e.eventType)
        .sort();
    expect(await types(member)).toEqual([
      'comment.created',
      'issue.created',
      'project.created',
      'story.added',
    ]);

    // With stories off, posting one is not shown either.
    await request(`/workspaces/${workspace.id}/stories-enabled`, {
      method: 'PUT',
      actor: owner,
      payload: { enabled: false },
    });
    expect(await types(member)).not.toContain('story.added');
  });

  test("shows only that person's events", async () => {
    const { owner, member, workspace } = await team();
    await createProject(owner, workspace.id);
    const shown = (await profileOf(owner, workspace.id, member.id)).json().activity;
    expect(shown).toEqual([]);
  });
});

describe('what a person shared', () => {
  test("is the images they added to issues here, not anyone else's", async () => {
    const { owner, member, workspace } = await team();
    const project = await createProject(owner, workspace.id);
    const issue = (
      await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
        method: 'POST',
        actor: owner,
        payload: { title: 'Screens' },
      })
    ).json().issue;
    const { app } = await getHarness();
    const image = await sharp({
      create: { width: 80, height: 60, channels: 3, background: '#000' },
    })
      .jpeg()
      .toBuffer();
    const upload = (actor: Actor) =>
      app.inject({
        method: 'POST',
        url: `/workspaces/${workspace.id}/issues/${issue.id}/attachments`,
        headers: { cookie: actor.cookie, 'content-type': 'image/jpeg' },
        payload: image,
      });
    const mine = (await upload(member)).json().attachment;
    await upload(owner);

    const shared = (await profileOf(owner, workspace.id, member.id)).json().shared;
    expect(shared.map((s: { id: string }) => s.id)).toEqual([mine.id]);
    expect(shared[0]).toMatchObject({ issueId: issue.id, width: 80, height: 60 });
    expect((await fetchImage(owner, shared[0].url)).statusCode).toBe(200);
  });
});

describe('reviewed edges', () => {
  test('taking down a comment is not shown on the moderator’s profile', async () => {
    const { owner, member, workspace } = await team();
    const project = await createProject(owner, workspace.id);
    const issue = (
      await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
        method: 'POST',
        actor: owner,
        payload: { title: 'Thread' },
      })
    ).json().issue;
    const comment = (
      await request(`/workspaces/${workspace.id}/issues/${issue.id}/comments`, {
        method: 'POST',
        actor: member,
        payload: { body: 'Off topic' },
      })
    ).json().comment;
    const down = await request(`/workspaces/${workspace.id}/comments/${comment.id}`, {
      method: 'DELETE',
      actor: owner,
    });
    expect(down.statusCode).toBe(204);
    const types = (await profileOf(member, workspace.id, owner.id))
      .json()
      .activity.map((e: { eventType: string }) => e.eventType);
    expect(types).not.toContain('comment.deleted');
  });

  test('removing a cover you do not have records nothing', async () => {
    const { member, workspace } = await team();
    const removed = await request(`/workspaces/${workspace.id}/people/me/cover`, {
      method: 'DELETE',
      actor: member,
    });
    expect(removed.statusCode).toBe(204);
    const { ownerDb } = await getHarness();
    const trail = await ownerDb
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.eventType, 'member.cover_removed'));
    expect(trail).toEqual([]);
  });

  test("an agent taken out of the workspace takes its cover's file with it", async () => {
    const { owner, workspace } = await team();
    const created = await request(`/workspaces/${workspace.id}/agents`, {
      method: 'POST',
      actor: owner,
      payload: { name: 'Cover bot', role: 'MEMBER' },
    });
    const agentId = created.json().agent.id as string;
    // Agents have no session to upload with, so the cover is set as one would be.
    const key = `covers/${workspace.id}/${crypto.randomUUID()}.webp`;
    await localDiskStorage(MEDIA_ROOT).put(key, new Uint8Array(await photo()), 'image/webp');
    const { ownerDb } = await getHarness();
    await ownerDb
      .update(workspaceMembers)
      .set({ coverKey: key, coverUpdatedAt: new Date() })
      .where(
        and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, agentId)),
      );
    expect(coverFiles(workspace.id)).toHaveLength(1);

    const removed = await request(`/workspaces/${workspace.id}/agents/${agentId}`, {
      method: 'DELETE',
      actor: owner,
    });
    expect(removed.statusCode).toBeLessThan(300);
    await runPurges();
    expect(coverFiles(workspace.id)).toEqual([]);
  });
});

describe('a cover photo', () => {
  test('is cropped wide, stripped of metadata and shown to members only', async () => {
    const { owner, member, workspace } = await team();
    const stranger = await createActor('Stranger');
    const set = await setCover(member, workspace.id, await photo());
    expect(set.statusCode).toBe(200);
    const url = set.json().profile.cover as string;
    expect(url).toStartWith(`/workspaces/${workspace.id}/people/${member.id}/cover?v=`);

    const served = await fetchImage(owner, url);
    expect(served.statusCode).toBe(200);
    expect(served.headers['cache-control']).toMatch(/^private/);
    const meta = await sharp(served.rawPayload).metadata();
    expect([meta.width, meta.height, meta.exif]).toEqual([1500, 500, undefined]);
    expect(served.rawPayload.includes(SECRET)).toBe(false);

    expect((await fetchImage(stranger, url)).statusCode).toBe(404);
  });

  test('a new one replaces the old, and removing it removes the file', async () => {
    const { member, workspace } = await team();
    await setCover(member, workspace.id, await photo());
    await setCover(member, workspace.id, await photo());
    await runPurges();
    expect(coverFiles(workspace.id)).toHaveLength(1);

    const removed = await request(`/workspaces/${workspace.id}/people/me/cover`, {
      method: 'DELETE',
      actor: member,
    });
    expect(removed.statusCode).toBe(204);
    await runPurges();
    expect(coverFiles(workspace.id)).toEqual([]);

    const { ownerDb } = await getHarness();
    const trail = await ownerDb
      .select({ type: auditEvents.eventType })
      .from(auditEvents)
      .where(eq(auditEvents.entityId, member.id));
    expect(trail.map((t) => t.type)).toEqual(
      expect.arrayContaining(['member.cover_set', 'member.cover_removed']),
    );
  });

  test('refuses what is not an image', async () => {
    const { member, workspace } = await team();
    const refused = await setCover(member, workspace.id, Buffer.from('not an image'));
    expect(refused.statusCode).toBe(400);
    expect(coverFiles(workspace.id)).toEqual([]);
  });

  test('goes with the membership: leaving, being removed, and the workspace deleted', async () => {
    const { owner, member, workspace } = await team();
    const other = await createActor('Other');
    await addMember(owner, workspace.id, other, 'MEMBER');
    await setCover(member, workspace.id, await photo());
    await setCover(other, workspace.id, await photo());
    await setCover(owner, workspace.id, await photo());

    await request(`/workspaces/${workspace.id}/members/me`, { method: 'DELETE', actor: member });
    await request(`/workspaces/${workspace.id}/members/${other.id}`, {
      method: 'DELETE',
      actor: owner,
    });
    await runPurges();
    expect(coverFiles(workspace.id)).toHaveLength(1);

    await request(`/workspaces/${workspace.id}`, {
      method: 'DELETE',
      actor: owner,
      payload: { password: ACTOR_PASSWORD },
    });
    await runPurges();
    expect(coverFiles(workspace.id)).toEqual([]);
  });
});
