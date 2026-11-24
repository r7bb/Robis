import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { channelReads } from '@robis/database';
import { and, eq } from 'drizzle-orm';
import {
  type Actor,
  addMember,
  closeHarness,
  createActor,
  createWorkspace,
  getHarness,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * Chat keeps your place: what others wrote since you read a room is its
 * unread count, marking it read clears it (and never moves back), and a
 * reaction is one per kind per person, shown with whether it is yours.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

async function room() {
  const me = await createActor('Me');
  const them = await createActor('Them');
  const workspace = await createWorkspace(me);
  await addMember(me, workspace.id, them, 'GUEST');
  const ws = `/workspaces/${workspace.id}`;
  const made = await request(`${ws}/channels`, {
    method: 'POST',
    actor: me,
    payload: { name: 'ops' },
  });
  return { me, them, ws, channelId: made.json().channel.id as string };
}

const say = async (actor: Actor, ws: string, channelId: string, body: string) =>
  (
    await request(`${ws}/channels/${channelId}/messages`, {
      method: 'POST',
      actor,
      payload: { body },
    })
  ).json().message as { id: string };

const unreadIn = async (actor: Actor, ws: string, channelId: string) => {
  const { rooms } = (await request(`${ws}/channel-reads`, { actor })).json() as {
    rooms: { channelId: string; unread: number; lastReadAt: string | null }[];
  };
  return rooms.find((r) => r.channelId === channelId)!;
};

describe('unread', () => {
  test('what others wrote waits as unread; your own never does', async () => {
    const { me, them, ws, channelId } = await room();
    await say(me, ws, channelId, 'Mine');
    await say(them, ws, channelId, 'One');
    await say(them, ws, channelId, 'Two');
    expect((await unreadIn(me, ws, channelId)).unread).toBe(2);
    expect((await unreadIn(them, ws, channelId)).unread).toBe(1);
  });

  test('marking read clears it, and later messages count again', async () => {
    const { me, them, ws, channelId } = await room();
    await say(them, ws, channelId, 'Before');
    const marked = await request(`${ws}/channels/${channelId}/read`, { method: 'PUT', actor: me });
    expect(marked.statusCode).toBe(200);
    const read = await unreadIn(me, ws, channelId);
    expect(read).toMatchObject({ unread: 0, lastReadAt: marked.json().lastReadAt });
    await say(them, ws, channelId, 'After');
    expect((await unreadIn(me, ws, channelId)).unread).toBe(1);
  });

  test('a mark never moves back', async () => {
    const { me, ws, channelId } = await room();
    await request(`${ws}/channels/${channelId}/read`, { method: 'PUT', actor: me });
    const { ownerDb } = await getHarness();
    const ahead = new Date(Date.now() + 60_000);
    await ownerDb
      .update(channelReads)
      .set({ lastReadAt: ahead })
      .where(and(eq(channelReads.channelId, channelId), eq(channelReads.userId, me.id)));
    const again = await request(`${ws}/channels/${channelId}/read`, { method: 'PUT', actor: me });
    expect(again.json().lastReadAt).toBe(ahead.toISOString());
  });

  test('another workspace’s room is not found, and its counts are not listed', async () => {
    const { ws, channelId } = await room();
    const other = await createActor('Other');
    const theirs = await createWorkspace(other, 'Theirs');
    const into = await request(`${ws}/channels/${channelId}/read`, { method: 'PUT', actor: other });
    expect(into.statusCode).toBe(404);
    const across = await request(`/workspaces/${theirs.id}/channels/${channelId}/read`, {
      method: 'PUT',
      actor: other,
    });
    expect(across.statusCode).toBe(404);
    const listed = (
      await request(`/workspaces/${theirs.id}/channel-reads`, { actor: other })
    ).json();
    expect(listed.rooms.map((r: { channelId: string }) => r.channelId)).not.toContain(channelId);
  });
});

describe('reactions', () => {
  test('one per kind per person, counted, with yours marked, and shown on the list', async () => {
    const { me, them, ws, channelId } = await room();
    const message = await say(them, ws, channelId, 'Shipped');
    const path = `${ws}/messages/${message.id}/reactions`;
    await request(`${path}/party`, { method: 'PUT', actor: me });
    await request(`${path}/party`, { method: 'PUT', actor: me });
    const both = await request(`${path}/party`, { method: 'PUT', actor: them });
    expect(both.json().reactions).toEqual([{ reaction: 'party', count: 2, mine: true }]);
    await request(`${path}/ok`, { method: 'PUT', actor: me });

    const listed = (await request(`${ws}/channels/${channelId}/messages`, { actor: me })).json();
    expect(listed.messages[0].reactions).toEqual([
      { reaction: 'ok', count: 1, mine: true },
      { reaction: 'party', count: 2, mine: true },
    ]);

    const off = await request(`${path}/party`, { method: 'DELETE', actor: me });
    expect(off.json().reactions).toEqual([
      { reaction: 'ok', count: 1, mine: true },
      { reaction: 'party', count: 1, mine: false },
    ]);
  });

  test('an unknown reaction, another workspace’s message, or signed out', async () => {
    const { me, them, ws, channelId } = await room();
    const message = await say(them, ws, channelId, 'Hello');
    const path = `${ws}/messages/${message.id}/reactions`;
    expect((await request(`${path}/shrug`, { method: 'PUT', actor: me })).statusCode).toBe(400);
    const other = await createActor('Other');
    const theirs = await createWorkspace(other, 'Theirs');
    const across = await request(`/workspaces/${theirs.id}/messages/${message.id}/reactions/ok`, {
      method: 'PUT',
      actor: other,
    });
    expect(across.statusCode).toBe(404);
    expect((await request(`${path}/ok`, { method: 'PUT' })).statusCode).toBe(401);
  });
});
