import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  type Actor,
  addMember,
  closeHarness,
  createActor,
  createWorkspace,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * Following and muting: the Following feed shows the people you follow and
 * you, the Everyone feed leaves out whom you muted, and both choices are
 * yours alone. Only members here can be chosen.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

async function team() {
  const me = await createActor('Me');
  const friend = await createActor('Friend');
  const loud = await createActor('Loud');
  const workspace = await createWorkspace(me);
  await addMember(me, workspace.id, friend, 'MEMBER');
  await addMember(me, workspace.id, loud, 'MEMBER');
  return { me, friend, loud, ws: `/workspaces/${workspace.id}` };
}

const say = (actor: Actor, ws: string, body: string) =>
  request(`${ws}/posts`, { method: 'POST', actor, payload: { body } });

async function bodies(actor: Actor, ws: string, scope?: 'everyone' | 'following') {
  const response = await request(`${ws}/feed${scope ? `?scope=${scope}` : ''}`, { actor });
  expect(response.statusCode).toBe(200);
  return response
    .json<{ items: { post?: { body: string } }[] }>()
    .items.map((item) => item.post?.body)
    .sort();
}

describe('following', () => {
  test('the Following feed holds the people you follow, and you; Everyone holds all', async () => {
    const { me, friend, loud, ws } = await team();
    await say(me, ws, 'mine');
    await say(friend, ws, 'from a friend');
    await say(loud, ws, 'from someone loud');

    expect(await bodies(me, ws, 'following')).toEqual(['mine']);
    expect(
      (await request(`${ws}/follows/${friend.id}`, { method: 'PUT', actor: me })).statusCode,
    ).toBe(204);
    expect(await bodies(me, ws, 'following')).toEqual(['from a friend', 'mine']);
    expect(await bodies(me, ws)).toEqual(['from a friend', 'from someone loud', 'mine']);

    const choices = (await request(`${ws}/follows`, { actor: me })).json<unknown>();
    expect(choices).toEqual({ following: [friend.id], muted: [] });
    // Theirs to know: the person followed sees nothing of it.
    expect((await request(`${ws}/follows`, { actor: friend })).json<unknown>()).toEqual({
      following: [],
      muted: [],
    });

    await request(`${ws}/follows/${friend.id}`, { method: 'DELETE', actor: me });
    expect(await bodies(me, ws, 'following')).toEqual(['mine']);
  });

  test('following twice is following once', async () => {
    const { me, friend, ws } = await team();
    for (let i = 0; i < 2; i++) {
      expect(
        (await request(`${ws}/follows/${friend.id}`, { method: 'PUT', actor: me })).statusCode,
      ).toBe(204);
    }
    expect((await request(`${ws}/follows`, { actor: me })).json().following).toEqual([friend.id]);
  });
});

describe('muting', () => {
  test('a muted person leaves your Everyone feed, and only yours', async () => {
    const { me, friend, loud, ws } = await team();
    await say(loud, ws, 'from someone loud');
    await say(friend, ws, 'from a friend');
    await request(`${ws}/mutes/${loud.id}`, { method: 'PUT', actor: me });

    expect(await bodies(me, ws)).toEqual(['from a friend']);
    expect(await bodies(friend, ws)).toEqual(['from a friend', 'from someone loud']);

    await request(`${ws}/mutes/${loud.id}`, { method: 'DELETE', actor: me });
    expect(await bodies(me, ws)).toEqual(['from a friend', 'from someone loud']);
  });
});

describe('who can be chosen', () => {
  test('not yourself, not a stranger, and not from outside the workspace', async () => {
    const { me, friend, ws } = await team();
    const stranger = await createActor('Stranger');
    expect((await request(`${ws}/follows/${me.id}`, { method: 'PUT', actor: me })).statusCode).toBe(
      400,
    );
    expect(
      (await request(`${ws}/follows/${stranger.id}`, { method: 'PUT', actor: me })).statusCode,
    ).toBe(404);
    expect((await request(`${ws}/mutes/not-an-id`, { method: 'PUT', actor: me })).statusCode).toBe(
      404,
    );
    expect(
      (await request(`${ws}/follows/${friend.id}`, { method: 'PUT', actor: stranger })).statusCode,
    ).toBe(404);
    expect((await request(`${ws}/feed?scope=nearby`, { actor: me })).statusCode).toBe(400);
  });
});

describe('following a space', () => {
  test('new threads in a followed space come to Following, and only there', async () => {
    const { me, friend, ws } = await team();
    const created = await request(`${ws}/spaces`, {
      method: 'POST',
      actor: friend,
      payload: { name: 'IT help' },
    });
    const space = created.json().space;
    expect(space.following).toBe(true);
    const ask = (title: string) =>
      request(`${ws}/spaces/${space.id}/threads`, {
        method: 'POST',
        actor: friend,
        payload: { kind: 'question', title },
      });
    await ask('Before I followed');

    const threads = async (scope: string) =>
      (await request(`${ws}/feed?scope=${scope}`, { actor: me }))
        .json<{ items: { kind: string; thread?: { title: string; spaceName: string } }[] }>()
        .items.filter((item) => item.kind === 'thread')
        .map((item) => item.thread);

    expect(await threads('following')).toEqual([]);
    expect(
      (await request(`${ws}/spaces/${space.id}/follow`, { method: 'PUT', actor: me })).statusCode,
    ).toBe(204);
    const listed = (await request(`${ws}/spaces`, { actor: me })).json().spaces[0];
    expect(listed.following).toBe(true);
    await ask('VPN drops at noon');
    expect((await threads('following')).map((t) => t?.title).sort()).toEqual([
      'Before I followed',
      'VPN drops at noon',
    ]);
    expect((await threads('following'))[0]?.spaceName).toBe('IT help');
    expect(await threads('everyone')).toEqual([]);

    await request(`${ws}/spaces/${space.id}/follow`, { method: 'DELETE', actor: me });
    expect(await threads('following')).toEqual([]);
  });

  test('a space of another workspace cannot be followed', async () => {
    const { me, ws } = await team();
    const stranger = await createActor('Stranger');
    const theirs = await createWorkspace(stranger, 'Elsewhere');
    const space = (
      await request(`/workspaces/${theirs.id}/spaces`, {
        method: 'POST',
        actor: stranger,
        payload: { name: 'Private' },
      })
    ).json().space;
    expect(
      (await request(`${ws}/spaces/${space.id}/follow`, { method: 'PUT', actor: me })).statusCode,
    ).toBe(404);
  });
});
