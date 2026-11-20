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
 * The feed (Phase 2c). Done when: posts of words or a photo, with comments
 * and three reactions, inside the workspace only; pictures from rooms mixed
 * in, newest first, a page at a time with an end; a caught-up marker of
 * your own; audited without the words; files gone with their post or
 * workspace, and counted in storage.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const SECRET = 'LOCATION-51.4545N-2.5879W';

function photo(colour = '#22c55e') {
  return sharp({ create: { width: 1600, height: 1200, channels: 3, background: colour } })
    .jpeg()
    .withExif({ IFD0: { Artist: SECRET } })
    .toBuffer();
}

async function raw(actor: Actor, url: string, body: Buffer, type = 'image/jpeg') {
  const { app } = await getHarness();
  return app.inject({
    method: 'POST',
    url,
    headers: { cookie: actor.cookie, 'content-type': type },
    payload: body,
  });
}

const say = (actor: Actor, workspaceId: string, body: string) =>
  request(`/workspaces/${workspaceId}/posts`, { method: 'POST', actor, payload: { body } });

const feedOf = async (actor: Actor, workspaceId: string, before?: string) =>
  (
    await request(`/workspaces/${workspaceId}/feed${before ? `?before=${before}` : ''}`, { actor })
  ).json();

function files(folder: string, workspaceId: string): string[] {
  try {
    return readdirSync(join(MEDIA_ROOT, folder, workspaceId));
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

async function team() {
  const owner = await createActor('Owner');
  const member = await createActor('Member');
  const workspace = await createWorkspace(owner);
  await addMember(owner, workspace.id, member, 'MEMBER');
  return { owner, member, workspace };
}

describe('posting', () => {
  test('words go on the feed, inside the workspace only; guests answer but do not post', async () => {
    const { owner, member, workspace } = await team();
    const stranger = await createActor('Stranger');
    const guest = await createActor('Guest');
    await addMember(owner, workspace.id, guest, 'GUEST');

    const posted = await say(member, workspace.id, 'Shipped the new board today');
    expect(posted.statusCode).toBe(201);
    const { post } = posted.json();
    expect(post).toMatchObject({
      kind: 'text',
      authorId: member.id,
      commentCount: 0,
      reactions: { celebrate: [], helpful: [], support: [] },
      photo: null,
    });

    const feed = await feedOf(owner, workspace.id);
    expect(feed.items).toEqual([{ kind: 'post', post: expect.objectContaining({ id: post.id }) }]);

    expect(
      (await request(`/workspaces/${workspace.id}/feed`, { actor: stranger })).statusCode,
    ).toBe(404);
    expect((await say(stranger, workspace.id, 'Hi')).statusCode).toBe(404);
    expect((await say(guest, workspace.id, 'Hi')).statusCode).toBe(403);
    const answered = await request(`/workspaces/${workspace.id}/posts/${post.id}/comments`, {
      method: 'POST',
      actor: guest,
      payload: { body: 'Lovely' },
    });
    expect(answered.statusCode).toBe(201);
    expect((await say(member, workspace.id, '   ')).statusCode).toBe(400);
  });

  test('a photo is stripped, members only, captioned by its author alone, and audited without words', async () => {
    const { owner, member, workspace } = await team();
    const stranger = await createActor('Stranger');
    const posted = await raw(member, `/workspaces/${workspace.id}/posts/photo`, await photo());
    expect(posted.statusCode).toBe(201);
    const { post } = posted.json();
    expect(post.photo).toMatchObject({ width: 1600, height: 1200 });

    const { app } = await getHarness();
    const served = await app.inject({
      method: 'GET',
      url: post.photo.url,
      headers: { cookie: owner.cookie },
    });
    expect(served.statusCode).toBe(200);
    expect(served.rawPayload.includes(SECRET)).toBe(false);
    const away = await app.inject({
      method: 'GET',
      url: post.photo.url,
      headers: { cookie: stranger.cookie },
    });
    expect(away.statusCode).toBe(404);

    const caption = (actor: Actor, body: string) =>
      request(`/workspaces/${workspace.id}/posts/${post.id}`, {
        method: 'PATCH',
        actor,
        payload: { body },
      });
    expect((await caption(owner, 'Not mine to write')).statusCode).toBe(403);
    const captioned = await caption(member, 'Our offsite view');
    expect(captioned.json().post).toMatchObject({ body: 'Our offsite view', editedAt: null });
    const changed = await caption(member, 'Our offsite, day one');
    expect(changed.json().post.editedAt).not.toBeNull();

    const { ownerDb } = await getHarness();
    const trail = await ownerDb
      .select({ payload: auditEvents.payload })
      .from(auditEvents)
      .where(eq(auditEvents.entityId, post.id));
    expect(trail.length).toBe(3);
    expect(trail.map((t) => t.payload).join(' ')).not.toContain('offsite');
  });
});

describe('the feed', () => {
  test('mixes in pictures from rooms, newest first, each linking back to its message', async () => {
    const { owner, member, workspace } = await team();
    const channel = (await request(`/workspaces/${workspace.id}/channels`, { actor: owner })).json()
      .channels[0];
    await say(member, workspace.id, 'First');
    const picture = (
      await raw(
        owner,
        `/workspaces/${workspace.id}/channels/${channel.id}/images`,
        await photo(),
        'image/jpeg',
      )
    ).json().message;
    await say(member, workspace.id, 'Third');

    const { items } = await feedOf(member, workspace.id);
    expect(items.map((i: { kind: string }) => i.kind)).toEqual(['post', 'picture', 'post']);
    expect(items[1].picture).toMatchObject({
      messageId: picture.id,
      channelId: channel.id,
      authorId: owner.id,
      url: `/workspaces/${workspace.id}/messages/${picture.id}/image`,
    });
  });

  test('comes a page at a time and ends: no cursor once there is nothing earlier', async () => {
    const { member, workspace } = await team();
    for (let i = 0; i < 23; i++) await say(member, workspace.id, `Update ${i}`);
    const first = await feedOf(member, workspace.id);
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toBeString();
    const second = await feedOf(member, workspace.id, first.nextCursor);
    expect(second.items).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    const bodies = [...first.items, ...second.items].map(
      (i: { post: { body: string } }) => i.post.body,
    );
    expect(new Set(bodies).size).toBe(23);
    expect(bodies[0]).toBe('Update 22');
    // A made-up cursor starts from the newest rather than failing.
    expect((await feedOf(member, workspace.id, 'nonsense')).items).toHaveLength(20);
  });

  test('remembers where each person last caught up', async () => {
    const { owner, member, workspace } = await team();
    expect((await feedOf(member, workspace.id)).seenAt).toBeNull();
    const seen = await request(`/workspaces/${workspace.id}/feed/seen`, {
      method: 'POST',
      actor: member,
    });
    expect(seen.statusCode).toBe(200);
    expect((await feedOf(member, workspace.id)).seenAt).toBe(seen.json().seenAt);
    expect((await feedOf(owner, workspace.id)).seenAt).toBeNull();
  });
});

describe('reactions and comments', () => {
  test('a reaction is once per person per kind, shown as who, and can be taken back', async () => {
    const { owner, member, workspace } = await team();
    const { post } = (await say(member, workspace.id, 'Demo went well')).json();
    const react = (actor: Actor, kind: string, method: 'PUT' | 'DELETE' = 'PUT') =>
      request(`/workspaces/${workspace.id}/posts/${post.id}/reactions/${kind}`, { method, actor });
    expect((await react(owner, 'celebrate')).statusCode).toBe(204);
    expect((await react(owner, 'celebrate')).statusCode).toBe(204);
    await react(member, 'celebrate');
    await react(owner, 'helpful');
    expect((await react(owner, 'love')).statusCode).toBe(400);

    let shown = (await feedOf(owner, workspace.id)).items[0].post.reactions;
    expect(shown).toEqual({ celebrate: [owner.id, member.id], helpful: [owner.id], support: [] });
    await react(owner, 'celebrate', 'DELETE');
    shown = (await feedOf(owner, workspace.id)).items[0].post.reactions;
    expect(shown.celebrate).toEqual([member.id]);
  });

  test('comments: listed oldest first; yours to take down, or an admin’s; counted on the post', async () => {
    const { owner, member, workspace } = await team();
    const other = await createActor('Other');
    await addMember(owner, workspace.id, other, 'MEMBER');
    const { post } = (await say(owner, workspace.id, 'Lunch?')).json();
    const comment = (actor: Actor, body: string) =>
      request(`/workspaces/${workspace.id}/posts/${post.id}/comments`, {
        method: 'POST',
        actor,
        payload: { body },
      });
    const first = (await comment(member, 'Yes')).json().comment;
    await comment(other, 'Me too');
    const listed = (
      await request(`/workspaces/${workspace.id}/posts/${post.id}/comments`, { actor: owner })
    ).json();
    expect(listed.comments.map((c: { body: string }) => c.body)).toEqual(['Yes', 'Me too']);
    expect((await feedOf(owner, workspace.id)).items[0].post.commentCount).toBe(2);

    const remove = (actor: Actor, id: string) =>
      request(`/workspaces/${workspace.id}/post-comments/${id}`, { method: 'DELETE', actor });
    expect((await remove(other, first.id)).statusCode).toBe(403);
    expect((await remove(member, first.id)).statusCode).toBe(204);
    const second = listed.comments[1];
    expect((await remove(owner, second.id)).statusCode).toBe(204);
    expect((await feedOf(owner, workspace.id)).items[0].post.commentCount).toBe(0);
  });
});

describe('taking a post down', () => {
  test('its author or an admin can; its photo goes, and so does the workspace’s on delete', async () => {
    const { owner, member, workspace } = await team();
    const other = await createActor('Other');
    await addMember(owner, workspace.id, other, 'MEMBER');
    const mine = (
      await raw(member, `/workspaces/${workspace.id}/posts/photo`, await photo())
    ).json().post;
    const theirs = (
      await raw(member, `/workspaces/${workspace.id}/posts/photo`, await photo('#000'))
    ).json().post;
    await raw(owner, `/workspaces/${workspace.id}/posts/photo`, await photo('#fff'));
    const { ownerDb } = await getHarness();
    expect(await workspaceStorageUsed(ownerDb, workspace.id)).toBeGreaterThan(0);

    const down = (actor: Actor, id: string) =>
      request(`/workspaces/${workspace.id}/posts/${id}`, { method: 'DELETE', actor });
    expect((await down(other, mine.id)).statusCode).toBe(403);
    expect((await down(member, mine.id)).statusCode).toBe(204);
    expect((await down(owner, theirs.id)).statusCode).toBe(204);
    await runPurges();
    expect(files('posts', workspace.id)).toHaveLength(1);

    await request(`/workspaces/${workspace.id}`, {
      method: 'DELETE',
      actor: owner,
      payload: { password: ACTOR_PASSWORD },
    });
    await runPurges();
    expect(files('posts', workspace.id)).toEqual([]);
  });

  test("posting shows on the author's profile; a take-down does not", async () => {
    const { owner, member, workspace } = await team();
    const { post } = (await say(member, workspace.id, 'Hello')).json();
    await request(`/workspaces/${workspace.id}/posts/${post.id}`, {
      method: 'DELETE',
      actor: owner,
    });
    const types = (p: Actor) =>
      request(`/workspaces/${workspace.id}/people/${p.id}`, { actor: member }).then((r) =>
        r.json().activity.map((e: { eventType: string }) => e.eventType),
      );
    expect(await types(member)).toContain('post.created');
    expect(await types(owner)).not.toContain('post.deleted');
  });
});

describe('reviewed edges', () => {
  test('a page still follows on when the last item of the one before has gone', async () => {
    const { member, workspace } = await team();
    for (let i = 0; i < 22; i++) await say(member, workspace.id, `Update ${i}`);
    const first = await feedOf(member, workspace.id);
    const last = first.items.at(-1).post;
    await request(`/workspaces/${workspace.id}/posts/${last.id}`, {
      method: 'DELETE',
      actor: member,
    });
    const second = await feedOf(member, workspace.id, first.nextCursor);
    expect(second.items.map((i: { post: { body: string } }) => i.post.body)).toEqual([
      'Update 1',
      'Update 0',
    ]);
  });

  test('deleting an account takes its photo posts and reactions, and keeps its words', async () => {
    const { owner, member, workspace } = await team();
    const words = (await say(member, workspace.id, 'Words stay')).json().post;
    await raw(member, `/workspaces/${workspace.id}/posts/photo`, await photo());
    const ownerPost = (await say(owner, workspace.id, 'Mine')).json().post;
    await request(`/workspaces/${workspace.id}/posts/${ownerPost.id}/reactions/support`, {
      method: 'PUT',
      actor: member,
    });
    const gone = await request('/auth/me', {
      method: 'DELETE',
      actor: member,
      payload: { password: ACTOR_PASSWORD, workspaces: [] },
    });
    expect(gone.statusCode).toBe(204);
    await runPurges();
    expect(files('posts', workspace.id)).toEqual([]);
    const items = (await feedOf(owner, workspace.id)).items;
    expect(items.map((i: { post: { id: string } }) => i.post.id).sort()).toEqual(
      [words.id, ownerPost.id].sort(),
    );
    const mine = items.find((i: { post: { id: string } }) => i.post.id === ownerPost.id);
    expect(mine.post.reactions.support).toEqual([]);
  });
});

describe('the weekly check-in', () => {
  test('is a post the team sees, and sets your Working on line; only you know you answered', async () => {
    const { owner, member, workspace } = await team();
    expect((await feedOf(member, workspace.id)).checkedInThisWeek).toBe(false);
    const answered = await request(`/workspaces/${workspace.id}/check-in`, {
      method: 'POST',
      actor: member,
      payload: { body: 'Onboarding redesign, first screens\nThen the pricing page' },
    });
    expect(answered.statusCode).toBe(201);
    expect(answered.json().post).toMatchObject({ kind: 'checkin' });

    expect((await feedOf(member, workspace.id)).checkedInThisWeek).toBe(true);
    const seen = await feedOf(owner, workspace.id);
    expect(seen.checkedInThisWeek).toBe(false);
    expect(seen.items[0].post).toMatchObject({ kind: 'checkin', authorId: member.id });
    const profile = await request(`/workspaces/${workspace.id}/people/${member.id}`, {
      actor: owner,
    });
    expect(profile.json().profile.workingOn).toBe('Onboarding redesign, first screens');
  });

  test('a guest is not asked to check in, and cannot', async () => {
    const { owner, workspace } = await team();
    const guest = await createActor('Guest');
    await addMember(owner, workspace.id, guest, 'GUEST');
    const refused = await request(`/workspaces/${workspace.id}/check-in`, {
      method: 'POST',
      actor: guest,
      payload: { body: 'Hello' },
    });
    expect(refused.statusCode).toBe(403);
  });
});
