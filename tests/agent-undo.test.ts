import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  addMember,
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * Undo an agent's change (idea 6): from the agents page, an admin puts a
 * field back, or removes a comment the agent wrote, through the same paths
 * a person's own edit takes, and never over someone else's later change.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

async function setUp() {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const project = await createProject(owner, workspace.id);
  const created = await request(`/workspaces/${workspace.id}/agents`, {
    method: 'POST',
    actor: owner,
    payload: { name: 'Change bot', role: 'MEMBER' },
  });
  const { token } = created.json();
  const bot = { authorization: `Bearer ${token.secret}` };
  const made = await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
    method: 'POST',
    actor: owner,
    payload: { title: 'Mine' },
  });
  const issue = made.json().issue as { id: string; key: string };
  const edit = (headers: Record<string, string> | null, payload: object) =>
    request(`/workspaces/${workspace.id}/issues/${issue.id}`, {
      method: 'PATCH',
      ...(headers ? { headers } : { actor: owner }),
      payload,
    });
  const changes = async () =>
    (await request(`/workspaces/${workspace.id}/agents/changes`, { actor: owner })).json()
      .changes as {
      id: string;
      field: string;
      state: string;
      issueKey: string | null;
      before: unknown;
      after: unknown;
    }[];
  const undo = (changeId: string, actor = owner) =>
    request(`/workspaces/${workspace.id}/agents/changes/${changeId}/undo`, {
      method: 'POST',
      actor,
    });
  const current = async () =>
    (await request(`/workspaces/${workspace.id}/issues/${issue.id}`, { actor: owner })).json()
      .issue as { priority: string; status: string; title: string };
  return { owner, workspace, project, bot, issue, edit, changes, undo, current };
}

describe('undoing an agent’s change', () => {
  test('lists the change with its issue, values and Undo on offer', async () => {
    const { bot, issue, edit, changes } = await setUp();
    expect((await edit(bot, { priority: 'HIGH' })).statusCode).toBe(200);

    const [change] = await changes();
    expect(change).toMatchObject({
      field: 'priority',
      before: 'NONE',
      after: 'HIGH',
      issueKey: issue.key,
      state: 'undoable',
    });
  });

  test('puts the field back, and it shows as undone', async () => {
    const { bot, edit, changes, undo, current } = await setUp();
    await edit(bot, { priority: 'HIGH' });
    const [change] = await changes();

    const response = await undo(change!.id);
    expect(response.statusCode).toBe(200);
    expect((await current()).priority).toBe('NONE');
    expect((await changes())[0]!.state).toBe('undone');
  });

  test('a second undo is refused', async () => {
    const { bot, edit, changes, undo } = await setUp();
    await edit(bot, { status: 'IN_PROGRESS' });
    const [change] = await changes();
    await undo(change!.id);

    const again = await undo(change!.id);
    expect(again.statusCode).toBe(409);
  });

  test('never over a person’s later change', async () => {
    const { bot, edit, changes, undo, current } = await setUp();
    await edit(bot, { priority: 'HIGH' });
    await edit(null, { priority: 'LOW' });
    const [change] = await changes();
    expect(change!.state).toBe('changed');

    const refused = await undo(change!.id);
    expect(refused.statusCode).toBe(409);
    expect((await current()).priority).toBe('LOW');
  });

  test('removes a comment the agent wrote', async () => {
    const { workspace, bot, issue, changes, undo } = await setUp();
    const posted = await request(`/workspaces/${workspace.id}/issues/${issue.id}/comments`, {
      method: 'POST',
      headers: bot,
      payload: { body: 'Looks like a duplicate' },
    });
    expect(posted.statusCode).toBe(201);
    const [change] = await changes();
    expect(change).toMatchObject({ field: 'created', state: 'undoable', issueKey: issue.key });

    expect((await undo(change!.id)).statusCode).toBe(200);
    const listed = await request(`/workspaces/${workspace.id}/issues/${issue.id}/comments`, {
      headers: bot,
    });
    expect(listed.json().comments).toHaveLength(0);
    expect((await changes())[0]!.state).toBe('gone');
  });

  test('an issue the agent made is not undone here', async () => {
    const { workspace, project, bot, changes, undo } = await setUp();
    await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      method: 'POST',
      headers: bot,
      payload: { title: 'From the bot' },
    });
    const [change] = await changes();
    expect(change).toMatchObject({ field: 'created', state: 'manual' });
    expect((await undo(change!.id)).statusCode).toBe(409);
  });

  test('the undo is in the audit trail, under the person who did it', async () => {
    const { owner, workspace, bot, edit, changes, undo } = await setUp();
    await edit(bot, { priority: 'URGENT' });
    const [change] = await changes();
    await undo(change!.id);

    const trail = await request(`/workspaces/${workspace.id}/audit/events`, { actor: owner });
    const latest = trail.json().events[0];
    expect(latest.actor.id).toBe(owner.id);
    expect(latest.type).toBe('issue.updated');
  });

  test('putting a parent back may not make the tree go round', async () => {
    const { owner, workspace, project, bot, changes, undo } = await setUp();
    const issueAt = (path: string, payload: object) =>
      request(`/workspaces/${workspace.id}${path}`, { method: 'POST', actor: owner, payload });
    const parent = (await issueAt(`/projects/${project.id}/issues`, { title: 'A' })).json().issue;
    const child = (
      await issueAt(`/projects/${project.id}/issues`, { title: 'X', parentId: parent.id })
    ).json().issue;
    const patch = (id: string, headers: Record<string, string> | null, payload: object) =>
      request(`/workspaces/${workspace.id}/issues/${id}`, {
        method: 'PATCH',
        ...(headers ? { headers } : { actor: owner }),
        payload,
      });
    // The agent takes X out from under A; then A is put under X.
    expect((await patch(child.id, bot, { parentId: null })).statusCode).toBe(200);
    expect((await patch(parent.id, null, { parentId: child.id })).statusCode).toBe(200);
    const change = (await changes()).find((c) => c.field === 'parentId')!;
    expect(change.state).toBe('undoable');

    const refused = await undo(change.id);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toBe('parent_cycle');
    const after = await request(`/workspaces/${workspace.id}/issues/${child.id}`, { actor: owner });
    expect(after.json().issue.parentId).toBeNull();
  });

  test('a change from another workspace is not found', async () => {
    const first = await setUp();
    await first.edit(first.bot, { priority: 'HIGH' });
    const [change] = await first.changes();
    const other = await createWorkspace(first.owner, 'Elsewhere');

    const response = await request(`/workspaces/${other.id}/agents/changes/${change!.id}/undo`, {
      method: 'POST',
      actor: first.owner,
    });
    expect(response.statusCode).toBe(404);
  });

  test('a member who is not an admin may not, and a stranger gets 404', async () => {
    const { owner, workspace, bot, edit, changes, undo } = await setUp();
    await edit(bot, { priority: 'HIGH' });
    const [change] = await changes();
    const member = await createActor('Member');
    await addMember(owner, workspace.id, member, 'MEMBER');
    const stranger = await createActor('Stranger');

    expect((await undo(change!.id, member)).statusCode).toBe(403);
    expect((await undo(change!.id, stranger)).statusCode).toBe(404);
    expect((await undo('not-a-change')).statusCode).toBe(404);
  });
});
