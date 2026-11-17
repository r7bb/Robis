import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { auditEvents } from '@robis/database';
import { eq } from 'drizzle-orm';
import {
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
 * Board filters and saved views (C1): the issue list narrows by priority and
 * label as well as status and assignee, and a filter can be kept by name,
 * shared with the workspace, every change audited.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

async function setUp() {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const project = await createProject(owner, workspace.id);
  const base = `/workspaces/${workspace.id}`;
  const views = `${base}/projects/${project.id}/views`;
  const file = async (title: string, priority = 'MEDIUM') =>
    (
      await request(`${base}/projects/${project.id}/issues`, {
        method: 'POST',
        actor: owner,
        payload: { title, priority },
      })
    ).json().issue;
  const save = (name: string, filter: object, actor = owner) =>
    request(views, { method: 'POST', actor, payload: { name, filter } });
  return { owner, workspace, project, base, views, file, save };
}

describe('the issue list', () => {
  test('narrows by priority and by label, scoped to the workspace', async () => {
    const { owner, project, base, file } = await setUp();
    const urgent = await file('On fire', 'URGENT');
    const labelled = await file('Tagged', 'LOW');
    await file('Plain', 'LOW');
    const bug = (
      await request(`${base}/labels`, {
        method: 'POST',
        actor: owner,
        payload: { name: 'Bug', colour: 'rose' },
      })
    ).json().label;
    await request(`${base}/issues/${labelled.id}/labels`, {
      method: 'PUT',
      actor: owner,
      payload: { labelIds: [bug.id] },
    });

    const list = async (query: string) =>
      (await request(`${base}/projects/${project.id}/issues?${query}`, { actor: owner }))
        .json()
        .issues.map((i: { id: string }) => i.id);
    expect(await list('priority=URGENT')).toEqual([urgent.id]);
    expect(await list(`labelId=${bug.id}`)).toEqual([labelled.id]);
    expect(await list(`labelId=${bug.id}&priority=URGENT`)).toEqual([]);
  });
});

describe('saved views', () => {
  test('keep a filter by name, listed by name for everyone in the workspace', async () => {
    const { owner, workspace, views, save } = await setUp();
    const made = await save('Urgent work', { priority: 'URGENT', status: 'IN_PROGRESS' });
    expect(made.statusCode).toBe(201);
    expect(made.json().view.filter).toEqual({ priority: 'URGENT', status: 'IN_PROGRESS' });
    await save('All low', { priority: 'LOW' });

    const guest = await createActor('Guest');
    await addMember(owner, workspace.id, guest, 'GUEST');
    const listed = (await request(views, { actor: guest })).json().views;
    expect(listed.map((v: { name: string }) => v.name)).toEqual(['All low', 'Urgent work']);
  });

  test('names are unique in a project, whatever their case, and so are filters', async () => {
    const { save } = await setUp();
    await save('Mine', { priority: 'HIGH' });
    const again = await save('MINE', { priority: 'LOW' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('view_exists');
    const twin = await save('Same issues', { priority: 'HIGH' });
    expect(twin.statusCode).toBe(409);
    expect(twin.json().message).toContain('Mine');
  });

  test('an empty filter is the board itself, and is not saved', async () => {
    const { save } = await setUp();
    expect((await save('Everything', {})).statusCode).toBe(400);
  });

  test('refuse a filter naming another workspace’s label or person', async () => {
    const { save } = await setUp();
    const stranger = await createActor('Stranger');
    const elsewhere = await createWorkspace(stranger);
    const theirs = (
      await request(`/workspaces/${elsewhere.id}/labels`, {
        method: 'POST',
        actor: stranger,
        payload: { name: 'Theirs', colour: 'sky' },
      })
    ).json().label;
    expect((await save('Probe', { labelId: theirs.id })).json().error).toBe('bad_filter');
    expect((await save('Probe', { assigneeId: stranger.id })).json().error).toBe('bad_filter');
    expect((await save('Bad', { priority: 'SOMEDAY' })).statusCode).toBe(400);
  });

  test('a guest may read them but not make or delete one', async () => {
    const { owner, workspace, base, save } = await setUp();
    const guest = await createActor('Guest');
    await addMember(owner, workspace.id, guest, 'GUEST');
    expect((await save('Nope', { status: 'DONE' }, guest)).statusCode).toBe(403);
    const view = (await save('Kept', { status: 'DONE' })).json().view;
    const del = await request(`${base}/views/${view.id}`, { method: 'DELETE', actor: guest });
    expect(del.statusCode).toBe(403);
  });

  test('are deleted once, audited both ways, and another workspace sees a 404', async () => {
    const { owner, workspace, base, views, save } = await setUp();
    const view = (await save('Short lived', { status: 'TODO' })).json().view;

    const stranger = await createActor('Stranger');
    const elsewhere = await createWorkspace(stranger);
    const probe = await request(`/workspaces/${elsewhere.id}/views/${view.id}`, {
      method: 'DELETE',
      actor: stranger,
    });
    expect(probe.statusCode).toBe(404);

    const del = await request(`${base}/views/${view.id}`, { method: 'DELETE', actor: owner });
    expect(del.statusCode).toBe(204);
    const twice = await request(`${base}/views/${view.id}`, { method: 'DELETE', actor: owner });
    expect(twice.statusCode).toBe(404);
    expect((await request(views, { actor: owner })).json().views).toEqual([]);

    const { ownerDb } = await getHarness();
    const events = await ownerDb
      .select({ type: auditEvents.eventType })
      .from(auditEvents)
      .where(eq(auditEvents.workspaceId, workspace.id));
    const types = events.map((e) => e.type);
    expect(types).toContain('saved_view.created');
    expect(types).toContain('saved_view.deleted');
  });
});
