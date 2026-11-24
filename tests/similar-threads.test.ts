import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  type Actor,
  closeHarness,
  createActor,
  createWorkspace,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * Asked before? While a thread is being written, threads already in the
 * workspace that share its words are offered, answered ones first, so a
 * question asked twice can be found instead; never another workspace's.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

type Similar = { id: string; title: string; solved: boolean; spaceName: string };

async function post<T>(actor: Actor, url: string, payload: unknown, key: string) {
  const response = await request(url, { method: 'POST', actor, payload });
  if (response.statusCode !== 201) throw new Error(`${url}: ${response.statusCode}`);
  return response.json()[key] as T & { id: string };
}

const similar = async (actor: Actor, ws: string, q: string) => {
  const response = await request(`${ws}/space-threads/similar?q=${encodeURIComponent(q)}`, {
    actor,
  });
  return { status: response.statusCode, threads: (response.json().threads ?? []) as Similar[] };
};

async function desk() {
  const me = await createActor('Me');
  const workspace = await createWorkspace(me);
  const ws = `/workspaces/${workspace.id}`;
  const space = await post(me, `${ws}/spaces`, { name: 'Help desk' }, 'space');
  const ask = (title: string, body = '') =>
    post(me, `${ws}/spaces/${space.id}/threads`, { kind: 'question', title, body }, 'thread');
  return { me, ws, ask };
}

describe('asked before', () => {
  test('shares words with the draft, answered ones first, named with their space', async () => {
    const { me, ws, ask } = await desk();
    const open = await ask('VPN keeps dropping at noon');
    const answered = await ask('Why does the VPN drop every day?');
    await ask('Lunch order for Friday');
    const reply = await post(
      me,
      `${ws}/space-threads/${answered.id}/replies`,
      { body: 'The noon backup saturates the link.' },
      'reply',
    );
    await request(`${ws}/space-threads/${answered.id}/answer`, {
      method: 'PUT',
      actor: me,
      payload: { replyId: reply.id },
    });

    const { threads } = await similar(me, ws, 'my vpn dropped again');
    expect(threads.map((t) => t.id)).toEqual([answered.id, open.id]);
    expect(threads[0]).toMatchObject({ solved: true, spaceName: 'Help desk' });
  });

  test('punctuation and query syntax in a draft are only words', async () => {
    const { me, ws, ask } = await desk();
    const proxy = await ask('Proxy refuses http://vpn.example.com/a:b links');
    const { status, threads } = await similar(me, ws, "what's | wrong & with the proxy: !links?");
    expect(status).toBe(200);
    expect(threads.map((t) => t.id)).toEqual([proxy.id]);
  });

  test('a draft too short or with nothing in common finds nothing', async () => {
    const { me, ws, ask } = await desk();
    await ask('VPN keeps dropping at noon');
    expect((await similar(me, ws, 'vpn')).threads).toEqual([]);
    expect((await similar(me, ws, 'the printer is jammed')).threads).toEqual([]);
    expect((await similar(me, ws, '')).threads).toEqual([]);
  });

  test('never another workspace’s threads, and signed in only', async () => {
    const { ws, ask } = await desk();
    await ask('VPN keeps dropping at noon');
    const other = await createActor('Other');
    const theirs = await createWorkspace(other, 'Theirs');
    expect((await similar(other, `/workspaces/${theirs.id}`, 'vpn dropping noon')).threads).toEqual(
      [],
    );
    expect((await similar(other, ws, 'vpn dropping noon')).status).toBe(404);
    const anonymous = await request(`${ws}/space-threads/similar?q=vpn+dropping`);
    expect(anonymous.statusCode).toBe(401);
  });
});
