import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { issues } from '@robis/database';
import { eq } from 'drizzle-orm';
import {
  type Actor,
  addMember,
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  getHarness,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * The team's week: the last seven days counted across the workspace, with
 * who finished most; older work and other workspaces are not counted.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

async function post<T>(actor: Actor, url: string, payload: unknown, key: string) {
  const response = await request(url, { method: 'POST', actor, payload });
  if (response.statusCode !== 201) throw new Error(`${url}: ${response.statusCode}`);
  return response.json()[key] as T & { id: string };
}

const week = async (actor: Actor, ws: string) =>
  (await request(`${ws}/feed/week`, { actor })).json();

describe('the team’s week', () => {
  test('counts this week’s work and names who finished most', async () => {
    const ana = await createActor('Ana');
    const bo = await createActor('Bo');
    const workspace = await createWorkspace(ana);
    await addMember(ana, workspace.id, bo, 'MEMBER');
    const ws = `/workspaces/${workspace.id}`;
    const project = await createProject(ana, workspace.id);
    const file = (title: string, assigneeId: string) =>
      post(ana, `${ws}/projects/${project.id}/issues`, { title, assigneeId }, 'issue');
    const finish = (id: string) =>
      request(`${ws}/issues/${id}`, { method: 'PATCH', actor: ana, payload: { status: 'DONE' } });
    for (const title of ['One', 'Two']) await finish((await file(title, bo.id)).id);
    await finish((await file('Three', ana.id)).id);
    await file('Still open', ana.id);

    const room = await post(ana, `${ws}/channels`, { name: 'ops' }, 'channel');
    await post(bo, `${ws}/channels/${room.id}/messages`, { body: 'Done with mine' }, 'message');
    const space = await post(ana, `${ws}/spaces`, { name: 'Desk' }, 'space');
    const asked = await post(
      ana,
      `${ws}/spaces/${space.id}/threads`,
      { kind: 'question', title: 'Where is the budget?', body: '' },
      'thread',
    );
    const reply = await post(
      bo,
      `${ws}/space-threads/${asked.id}/replies`,
      { body: 'Drive' },
      'reply',
    );
    await request(`${ws}/space-threads/${asked.id}/answer`, {
      method: 'PUT',
      actor: ana,
      payload: { replyId: reply.id },
    });

    const counted = await week(bo, ws);
    expect(counted).toMatchObject({
      issuesDone: 3,
      issuesOpened: 4,
      answered: 1,
      threadsStarted: 1,
      messages: 1,
      finishers: [
        { userId: bo.id, name: 'Bo', done: 2 },
        { userId: ana.id, name: 'Ana', done: 1 },
      ],
    });
  });

  test('work finished before the week is not counted, nor another workspace’s', async () => {
    const ana = await createActor('Ana');
    const workspace = await createWorkspace(ana);
    const ws = `/workspaces/${workspace.id}`;
    const project = await createProject(ana, workspace.id);
    const old = await post(ana, `${ws}/projects/${project.id}/issues`, { title: 'Old' }, 'issue');
    await request(`${ws}/issues/${old.id}`, {
      method: 'PATCH',
      actor: ana,
      payload: { status: 'DONE' },
    });
    const { ownerDb } = await getHarness();
    await ownerDb
      .update(issues)
      .set({ completedAt: new Date(Date.now() - 9 * 24 * 3_600_000) })
      .where(eq(issues.id, old.id));
    expect((await week(ana, ws)).issuesDone).toBe(0);

    const other = await createActor('Other');
    const theirs = await createWorkspace(other, 'Theirs');
    expect(await week(other, `/workspaces/${theirs.id}`)).toMatchObject({
      issuesDone: 0,
      issuesOpened: 0,
      finishers: [],
    });
    expect((await request(`${ws}/feed/week`, { actor: other })).statusCode).toBe(404);
  });
});
