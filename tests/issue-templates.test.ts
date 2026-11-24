import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  type Actor,
  addMember,
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * Issue templates: a starting point for a kind of issue (its title, the
 * description to fill in, a priority and labels), kept for the workspace
 * and filed onto any of its boards. Members make and use them; guests use
 * none; a label removed since is left off.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const BUG = {
  name: 'Bug report',
  title: 'Bug:',
  description: 'What happened:\n\nWhat should have happened:\n\nSteps:',
  priority: 'HIGH',
};

async function setUp() {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const project = await createProject(owner, workspace.id, 'Web');
  const ws = `/workspaces/${workspace.id}`;
  const label = async (name: string) =>
    (
      await request(`${ws}/labels`, {
        method: 'POST',
        actor: owner,
        payload: { name, colour: 'sky' },
      })
    ).json().label as { id: string };
  const make = (actor: Actor, body: Record<string, unknown>) =>
    request(`${ws}/issue-templates`, { method: 'POST', actor, payload: body });
  const file = (actor: Actor, templateId: string, body: Record<string, unknown>) =>
    request(`${ws}/issue-templates/${templateId}/issues`, {
      method: 'POST',
      actor,
      payload: body,
    });
  return { owner, workspace, project, ws, label, make, file };
}

describe('issue templates', () => {
  test('made, listed, and filed onto a board with its description, priority and labels', async () => {
    const { owner, project, ws, label, make, file } = await setUp();
    const bug = await label('bug');
    const made = await make(owner, { ...BUG, labelIds: [bug.id] });
    expect(made.statusCode).toBe(201);
    const template = made.json().template;
    expect(template).toMatchObject({ ...BUG, labelIds: [bug.id] });

    const listed = (await request(`${ws}/issue-templates`, { actor: owner })).json();
    expect(listed.templates.map((t: { name: string }) => t.name)).toEqual(['Bug report']);

    const filed = await file(owner, template.id, {
      projectId: project.id,
      title: 'Bug: the login loops',
    });
    expect(filed.statusCode).toBe(201);
    const { issue } = filed.json();
    expect(issue.key).toMatch(/-1$/);
    const read = (await request(`${ws}/issues/${issue.id}`, { actor: owner })).json().issue;
    expect(read).toMatchObject({
      title: 'Bug: the login loops',
      description: BUG.description,
      priority: 'HIGH',
      status: 'TODO',
      labelIds: [bug.id],
      projectId: project.id,
    });
  });

  test('the template’s own title when none is given; a label removed since is left off', async () => {
    const { owner, project, ws, label, make, file } = await setUp();
    const gone = await label('gone');
    const kept = await label('kept');
    const template = (
      await make(owner, {
        name: 'Weekly check',
        title: 'Weekly check',
        labelIds: [gone.id, kept.id],
      })
    ).json().template;
    await request(`${ws}/labels/${gone.id}`, { method: 'DELETE', actor: owner });

    const { issue } = (await file(owner, template.id, { projectId: project.id })).json();
    const read = (await request(`${ws}/issues/${issue.id}`, { actor: owner })).json().issue;
    expect(read).toMatchObject({ title: 'Weekly check', priority: 'NONE', labelIds: [kept.id] });
  });

  test('a label from another workspace is refused; so is a board from one', async () => {
    const { owner, make, file } = await setUp();
    const stranger = await createActor('Stranger');
    const theirs = await createWorkspace(stranger);
    const theirLabel = (
      await request(`/workspaces/${theirs.id}/labels`, {
        method: 'POST',
        actor: stranger,
        payload: { name: 'theirs', colour: 'sky' },
      })
    ).json().label;
    const refused = await make(owner, { ...BUG, labelIds: [theirLabel.id] });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toBe('bad_label');

    const template = (await make(owner, BUG)).json().template;
    const theirBoard = await createProject(stranger, theirs.id, 'Theirs');
    expect((await file(owner, template.id, { projectId: theirBoard.id })).statusCode).toBe(404);
  });

  test('a guest neither makes nor files; whoever made one, or an admin, removes it', async () => {
    const { owner, workspace, project, ws, make, file } = await setUp();
    const guest = await createActor('Guest');
    const member = await createActor('Member');
    await addMember(owner, workspace.id, guest, 'GUEST');
    await addMember(owner, workspace.id, member, 'MEMBER');
    expect((await make(guest, BUG)).statusCode).toBe(403);
    const template = (await make(owner, BUG)).json().template;
    expect((await file(guest, template.id, { projectId: project.id })).statusCode).toBe(403);
    expect((await request(`${ws}/issue-templates`, { actor: guest })).statusCode).toBe(200);

    const remove = (actor: Actor) =>
      request(`${ws}/issue-templates/${template.id}`, { method: 'DELETE', actor });
    expect((await remove(member)).statusCode).toBe(403);
    expect((await remove(owner)).statusCode).toBe(204);
    expect((await request(`${ws}/issue-templates`, { actor: owner })).json().templates).toEqual([]);
  });

  test('another workspace’s template is not found', async () => {
    const { owner, project, make, file } = await setUp();
    const template = (await make(owner, BUG)).json().template;
    const stranger = await createActor('Stranger');
    const theirs = await createWorkspace(stranger);
    const asStranger = await request(
      `/workspaces/${theirs.id}/issue-templates/${template.id}/issues`,
      {
        method: 'POST',
        actor: stranger,
        payload: { projectId: project.id },
      },
    );
    expect(asStranger.statusCode).toBe(404);
    expect(
      (await file(owner, '00000000-0000-4000-8000-000000000000', { projectId: project.id }))
        .statusCode,
    ).toBe(404);
  });
});
