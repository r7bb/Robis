import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { describeNotification, notificationHref } from '@robis/web/lib/notification-text.ts';
import { handlers } from '@robis/worker/handlers';
import { Runner } from '@robis/worker/runner';
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
 * Spaces tell people (C3): whoever asked hears of each reply, whoever is
 * replied to hears too, whoever answered hears once their reply is marked,
 * and nobody hears of what they did themselves.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

type Item = {
  kind: string;
  workspaceId: string | null;
  actorName: string | null;
  payload: Record<string, string>;
};

async function team() {
  const asker = await createActor('Asker');
  const helper = await createActor('Helper');
  const third = await createActor('Third');
  const workspace = await createWorkspace(asker);
  await addMember(asker, workspace.id, helper, 'MEMBER');
  await addMember(asker, workspace.id, third, 'GUEST');
  return { asker, helper, third, ws: `/workspaces/${workspace.id}`, workspaceId: workspace.id };
}

async function post<T>(actor: Actor, url: string, payload: unknown, key: string) {
  const response = await request(url, { method: 'POST', actor, payload });
  if (response.statusCode !== 201) throw new Error(`${url}: ${response.statusCode}`);
  return response.json()[key] as T & { id: string };
}

async function question(asker: Actor, ws: string) {
  const space = await post(asker, `${ws}/spaces`, { name: 'Help desk' }, 'space');
  return post(
    asker,
    `${ws}/spaces/${space.id}/threads`,
    { kind: 'question', title: 'VPN drops at noon', body: 'Every day.' },
    'thread',
  );
}

const reply = (actor: Actor, ws: string, threadId: string, body: string, parentId?: string) =>
  post(actor, `${ws}/space-threads/${threadId}/replies`, { body, parentId }, 'reply');

const mark = (actor: Actor, ws: string, threadId: string, replyId: string | null) =>
  request(`${ws}/space-threads/${threadId}/answer`, {
    method: 'PUT',
    actor,
    payload: { replyId },
  });

async function runJobs() {
  const { workerDb } = await getHarness();
  await new Runner({ db: workerDb, handlers }).tick();
}

const inbox = async (actor: Actor) =>
  (await request('/notifications', { actor })).json().notifications as Item[];

describe('replies in spaces', () => {
  test('whoever asked hears of a reply, with where it leads', async () => {
    const { asker, helper, ws, workspaceId } = await team();
    const asked = await question(asker, ws);
    const answer = await reply(helper, ws, asked.id, 'Turn off the noon backup.');
    await runJobs();

    const [item, ...rest] = await inbox(asker);
    expect(rest).toEqual([]);
    expect(item).toMatchObject({
      kind: 'space_reply',
      actorName: 'Helper',
      payload: { threadId: asked.id, replyId: answer.id, title: 'VPN drops at noon' },
    });
    expect(describeNotification(item!)).toEqual({
      actor: 'Helper',
      did: 'replied in',
      subject: 'VPN drops at noon',
      body: 'Turn off the noon backup.',
    });
    expect(notificationHref(item!)).toBe(
      `/workspaces/${workspaceId}/spaces/threads/${asked.id}#reply-${answer.id}`,
    );
    expect(await inbox(helper)).toEqual([]);
  });

  test('a reply to a reply tells both its author and whoever asked, once each', async () => {
    const { asker, helper, third, ws } = await team();
    const asked = await question(asker, ws);
    const first = await reply(helper, ws, asked.id, 'Is it the backup?');
    await reply(third, ws, asked.id, 'Yes, it is the backup.', first.id);
    await runJobs();
    await runJobs();

    expect((await inbox(helper)).map((n) => n.kind)).toEqual(['space_reply']);
    expect((await inbox(asker)).map((n) => n.kind)).toEqual(['space_reply', 'space_reply']);
    expect(await inbox(third)).toEqual([]);
  });

  test('replying in your own thread tells no one', async () => {
    const { asker, ws } = await team();
    const asked = await question(asker, ws);
    await reply(asker, ws, asked.id, 'Adding: also at midnight.');
    await runJobs();
    expect(await inbox(asker)).toEqual([]);
  });

  test('a reply taken down before the job runs tells no one', async () => {
    const { asker, helper, ws } = await team();
    const asked = await question(asker, ws);
    const gone = await reply(helper, ws, asked.id, 'Oops, wrong thread.');
    const removed = await request(`${ws}/space-replies/${gone.id}`, {
      method: 'DELETE',
      actor: helper,
    });
    expect(removed.statusCode).toBe(204);
    await runJobs();
    expect(await inbox(asker)).toEqual([]);
  });

  test('turned off, a space reply makes nothing', async () => {
    const { asker, helper, ws } = await team();
    for (const channel of ['in_app', 'email', 'push']) {
      const set = await request('/me/notification-settings', {
        method: 'PUT',
        actor: asker,
        payload: { kind: 'space_reply', channel, enabled: false },
      });
      expect(set.statusCode).toBe(200);
    }
    const asked = await question(asker, ws);
    await reply(helper, ws, asked.id, 'Turn off the noon backup.');
    await runJobs();
    expect(await inbox(asker)).toEqual([]);
  });
});

describe('answers marked', () => {
  test('whoever answered hears once, however often it is marked again', async () => {
    const { asker, helper, ws } = await team();
    const asked = await question(asker, ws);
    const answer = await reply(helper, ws, asked.id, 'Turn off the noon backup.');
    await runJobs();

    expect((await mark(asker, ws, asked.id, answer.id)).statusCode).toBe(200);
    await mark(asker, ws, asked.id, null);
    await mark(asker, ws, asked.id, answer.id);
    await runJobs();

    const items = await inbox(helper);
    expect(items.map((n) => n.kind)).toEqual(['space_answer']);
    expect(describeNotification(items[0]!)).toMatchObject({
      did: 'marked your reply as the answer to',
      subject: 'VPN drops at noon',
    });
  });

  test('unmarked before the job runs, an answer tells no one', async () => {
    const { asker, helper, ws } = await team();
    const asked = await question(asker, ws);
    const answer = await reply(helper, ws, asked.id, 'Turn off the noon backup.');
    await runJobs();
    await mark(asker, ws, asked.id, answer.id);
    await mark(asker, ws, asked.id, null);
    await runJobs();
    expect(await inbox(helper)).toEqual([]);
  });

  test('marking your own reply as the answer tells no one', async () => {
    const { asker, ws } = await team();
    const asked = await question(asker, ws);
    const mine = await reply(asker, ws, asked.id, 'Fixed it myself: the backup.');
    await mark(asker, ws, asked.id, mine.id);
    await runJobs();
    expect(await inbox(asker)).toEqual([]);
  });
});
