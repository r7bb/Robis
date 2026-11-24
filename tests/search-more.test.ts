import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import type { SEARCH_KINDS } from '@robis/shared';
import { hitHref } from '@robis/web/lib/search-links.ts';
import {
  type Actor,
  closeHarness,
  createActor,
  createWorkspace,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * Search beyond issues (C1): chat, space threads and their replies, and
 * meetings are found as issues are, each leading to where it is, and never
 * from another workspace.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

type Hit = {
  kind: (typeof SEARCH_KINDS)[number];
  id: string;
  title: string;
  issueId: string | null;
  channelId: string | null;
  threadId: string | null;
};

async function post<T>(actor: Actor, url: string, payload: unknown, key: string) {
  const response = await request(url, { method: 'POST', actor, payload });
  if (response.statusCode !== 201) throw new Error(`${url}: ${response.statusCode}`);
  return response.json()[key] as T & { id: string };
}

const search = async (actor: Actor, ws: string, q: string, type?: string) =>
  (
    await request(`${ws}/search?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ''}`, {
      actor,
    })
  ).json().results as Hit[];

async function setUp() {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  return { owner, workspaceId: workspace.id, ws: `/workspaces/${workspace.id}` };
}

describe('search across chat, spaces and meetings', () => {
  test('finds a chat message, titled by its room, leading to the message', async () => {
    const { owner, workspaceId, ws } = await setUp();
    const room = await post(owner, `${ws}/channels`, { name: 'ops' }, 'channel');
    const message = await post(
      owner,
      `${ws}/channels/${room.id}/messages`,
      { body: 'The kubernetes upgrade lands on Thursday' },
      'message',
    );

    const [hit, ...rest] = await search(owner, ws, 'kubernetes');
    expect(rest).toEqual([]);
    expect(hit).toMatchObject({
      kind: 'message',
      id: message.id,
      title: '#ops',
      channelId: room.id,
    });
    expect(hitHref(workspaceId, hit!)).toBe(
      `/workspaces/${workspaceId}?channel=${room.id}#message-${message.id}`,
    );
  });

  test('finds a thread and a reply in it; Spaces narrows to both', async () => {
    const { owner, workspaceId, ws } = await setUp();
    const space = await post(owner, `${ws}/spaces`, { name: 'Help desk' }, 'space');
    const asked = await post(
      owner,
      `${ws}/spaces/${space.id}/threads`,
      { kind: 'question', title: 'Printer jams on tray two', body: 'Every morning.' },
      'thread',
    );
    const answer = await post(
      owner,
      `${ws}/space-threads/${asked.id}/replies`,
      { body: 'The printer needs the thicker paper in tray two.' },
      'reply',
    );

    const hits = await search(owner, ws, 'printer', 'thread');
    expect(hits.map((h) => h.kind).sort()).toEqual(['reply', 'thread']);
    const reply = hits.find((h) => h.kind === 'reply')!;
    expect(reply).toMatchObject({
      id: answer.id,
      title: 'Printer jams on tray two',
      threadId: asked.id,
    });
    expect(hitHref(workspaceId, reply)).toBe(
      `/workspaces/${workspaceId}/spaces/threads/${asked.id}#reply-${answer.id}`,
    );
    expect(hitHref(workspaceId, hits.find((h) => h.kind === 'thread')!)).toBe(
      `/workspaces/${workspaceId}/spaces/threads/${asked.id}`,
    );
  });

  test('a reply taken down is no longer found', async () => {
    const { owner, ws } = await setUp();
    const space = await post(owner, `${ws}/spaces`, { name: 'Help desk' }, 'space');
    const asked = await post(
      owner,
      `${ws}/spaces/${space.id}/threads`,
      { kind: 'discussion', title: 'Lunch', body: '' },
      'thread',
    );
    const gone = await post(
      owner,
      `${ws}/space-threads/${asked.id}/replies`,
      { body: 'A zeppelin joke, on second thoughts not.' },
      'reply',
    );
    await request(`${ws}/space-replies/${gone.id}`, { method: 'DELETE', actor: owner });
    expect(await search(owner, ws, 'zeppelin')).toEqual([]);
  });

  test('finds a meeting by its agenda, but not once it is called off', async () => {
    const { owner, workspaceId, ws } = await setUp();
    const meeting = await post(
      owner,
      `${ws}/meetings`,
      {
        title: 'Quarterly planning',
        agenda: 'Budget for the observatory',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
      'meeting',
    );

    const [hit] = await search(owner, ws, 'observatory', 'meeting');
    expect(hit).toMatchObject({ kind: 'meeting', id: meeting.id, title: 'Quarterly planning' });
    expect(hitHref(workspaceId, hit!)).toBe(
      `/workspaces/${workspaceId}/meetings#meeting-${meeting.id}`,
    );

    await request(`${ws}/meetings/${meeting.id}`, { method: 'DELETE', actor: owner });
    expect(await search(owner, ws, 'observatory')).toEqual([]);
  });

  test('none of it crosses into another workspace', async () => {
    const { owner, ws } = await setUp();
    const room = await post(owner, `${ws}/channels`, { name: 'ops' }, 'channel');
    await post(owner, `${ws}/channels/${room.id}/messages`, { body: 'Secret zebra' }, 'message');
    const space = await post(owner, `${ws}/spaces`, { name: 'Desk' }, 'space');
    await post(
      owner,
      `${ws}/spaces/${space.id}/threads`,
      { kind: 'idea', title: 'Zebra crossing', body: '' },
      'thread',
    );

    const other = await createActor('Other');
    const theirs = await createWorkspace(other, 'Theirs');
    expect(await search(other, `/workspaces/${theirs.id}`, 'zebra')).toEqual([]);
    const trespass = await request(`${ws}/search?q=zebra`, { actor: other });
    expect(trespass.statusCode).toBe(404);
  });
});
