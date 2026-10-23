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
 * The signed-in home's overview: for each of your workspaces, how much is
 * open, who is in it, how busy the last two weeks were and what happened
 * last; and the open issues waiting on you. Only what your role can read.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const DAY_MS = 24 * 60 * 60 * 1000;

async function createIssue(
  actor: Actor,
  workspaceId: string,
  projectId: string,
  fields: { title: string; status?: string; assigneeId?: string },
) {
  const response = await request(`/workspaces/${workspaceId}/projects/${projectId}/issues`, {
    method: 'POST',
    actor,
    payload: fields,
  });
  expect(response.statusCode).toBe(201);
  return response.json().issue as { id: string };
}

function overview(actor: Actor) {
  return request('/workspaces/overview', { actor });
}

describe('the workspace overview', () => {
  test('counts open issues, and lists the open ones assigned to you, newest first', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const project = await createProject(owner, workspace.id);
    await createIssue(owner, workspace.id, project.id, { title: 'Older', assigneeId: owner.id });
    await createIssue(owner, workspace.id, project.id, { title: 'Newer', assigneeId: owner.id });
    await createIssue(owner, workspace.id, project.id, { title: 'Not mine' });
    await createIssue(owner, workspace.id, project.id, {
      title: 'Finished',
      status: 'DONE',
      assigneeId: owner.id,
    });

    const response = await overview(owner);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const [tile] = body.workspaces;
    expect(tile.id).toBe(workspace.id);
    expect(tile.openIssues).toBe(3);

    expect(body.assigned.map((issue: { title: string }) => issue.title)).toEqual([
      'Newer',
      'Older',
    ]);
    expect(body.assigned[0]).toMatchObject({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      key: expect.stringMatching(/^[A-Z]+-\d+$/),
      status: 'TODO',
    });
  });

  test('shows a few members with their pictures, and how many there are', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    for (let n = 0; n < 6; n++) {
      await addMember(owner, workspace.id, await createActor(`Member ${n}`), 'MEMBER');
    }

    const [tile] = (await overview(owner)).json().workspaces;
    expect(tile.memberCount).toBe(7);
    expect(tile.members).toHaveLength(5);
    expect(tile.members[0]).toMatchObject({ name: 'Owner', avatar: { kind: 'generated' } });
  });

  test('counts the last 14 days of activity, oldest day first, and names the latest', async () => {
    const owner = await createActor('Owner');
    const mia = await createActor('Mia');
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id, mia, 'MEMBER');
    const project = await createProject(owner, workspace.id);
    const old = await createIssue(owner, workspace.id, project.id, { title: 'Long ago' });
    const { db } = await getHarness();
    const threeDaysAgo = new Date(Date.now() - 3 * DAY_MS);
    await db
      .update(issues)
      .set({ createdAt: threeDaysAgo, updatedAt: threeDaysAgo })
      .where(eq(issues.id, old.id));

    const today = await createIssue(owner, workspace.id, project.id, { title: 'Ship it' });
    const comment = await request(`/workspaces/${workspace.id}/issues/${today.id}/comments`, {
      method: 'POST',
      actor: mia,
      payload: { body: 'On it' },
    });
    expect(comment.statusCode).toBe(201);

    const [tile] = (await overview(owner)).json().workspaces;
    expect(tile.activity).toHaveLength(14);
    // Today: the new issue and the comment. Three days ago: the old issue.
    expect(tile.activity[13]).toBe(2);
    expect(tile.activity[10]).toBe(1);
    expect(tile.activity.reduce((a: number, b: number) => a + b, 0)).toBe(3);

    expect(tile.latest).toMatchObject({
      kind: 'comment.created',
      actorName: 'Mia',
      issueId: today.id,
      issueTitle: 'Ship it',
    });
    // Says who and what, never the comment itself.
    expect(JSON.stringify(tile.latest)).not.toContain('On it');
  });

  test('a quiet workspace has zero activity and nothing latest', async () => {
    const owner = await createActor('Owner');
    await createWorkspace(owner);
    const [tile] = (await overview(owner)).json().workspaces;
    expect(tile.openIssues).toBe(0);
    expect(tile.activity).toEqual(Array(14).fill(0));
    expect(tile.latest).toBeNull();
  });

  test('includes only your own workspaces, and none of another one', async () => {
    const owner = await createActor('Owner');
    const outsider = await createActor('Outsider');
    const theirs = await createWorkspace(owner, 'Private');
    const project = await createProject(owner, theirs.id);
    await createIssue(owner, theirs.id, project.id, { title: 'Secret', assigneeId: owner.id });
    const mine = await createWorkspace(outsider, 'Mine');

    const body = (await overview(outsider)).json();
    expect(body.workspaces.map((w: { id: string }) => w.id)).toEqual([mine.id]);
    expect(body.assigned).toEqual([]);
    expect(body.assignedTotal).toBe(0);
    expect(JSON.stringify(body)).not.toContain('Secret');
  });

  test('says how many wait on you in all, though it lists only five', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const project = await createProject(owner, workspace.id);
    for (let n = 0; n < 7; n++) {
      await createIssue(owner, workspace.id, project.id, {
        title: `Task ${n}`,
        assigneeId: owner.id,
      });
    }
    const body = (await overview(owner)).json();
    expect(body.assigned).toHaveLength(5);
    expect(body.assignedTotal).toBe(7);
  });

  test('forgets a workspace you were removed from, even with issues still assigned to you', async () => {
    const owner = await createActor('Owner');
    const leaver = await createActor('Leaver');
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id, leaver, 'MEMBER');
    const project = await createProject(owner, workspace.id);
    await createIssue(owner, workspace.id, project.id, { title: 'Theirs', assigneeId: leaver.id });
    const removed = await request(`/workspaces/${workspace.id}/members/${leaver.id}`, {
      method: 'DELETE',
      actor: owner,
    });
    expect(removed.statusCode).toBe(204);

    const body = (await overview(leaver)).json();
    expect(body).toMatchObject({ workspaces: [], assigned: [], assignedTotal: 0 });
  });

  test('counts a later edit as activity of its own', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const project = await createProject(owner, workspace.id);
    const issue = await createIssue(owner, workspace.id, project.id, { title: 'Edited' });
    const { db } = await getHarness();
    await db
      .update(issues)
      .set({ updatedAt: new Date(Date.now() + 60_000) })
      .where(eq(issues.id, issue.id));
    const [tile] = (await overview(owner)).json().workspaces;
    expect(tile.activity[13]).toBe(2);
  });

  test('needs a session', async () => {
    expect((await request('/workspaces/overview')).statusCode).toBe(401);
  });
});
