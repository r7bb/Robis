import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { TEMPLATE_DETAILS } from '@robis/shared';
import { closeHarness, createActor, createWorkspace, request, resetDatabase } from './harness.ts';

/**
 * Starter projects (C5). Done when: a project made from a template opens
 * with that template's issues, in order from the top of the board; an
 * unknown template is refused; and a project without one starts empty.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

async function make(payload: Record<string, unknown>) {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const made = await request(`/workspaces/${workspace.id}/projects`, {
    method: 'POST',
    actor: owner,
    payload,
  });
  return { owner, workspace, made };
}

describe('a project from a template', () => {
  test("opens with the template's issues, top of the board first", async () => {
    const { owner, workspace, made } = await make({ name: 'Spring launch', template: 'event' });
    expect(made.statusCode).toBe(201);
    const project = made.json().project as { id: string };
    const listed = await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      actor: owner,
    });
    const issues = listed.json().issues as { title: string; position: string; status: string }[];
    const byBoard = [...issues].sort((a, b) => (a.position < b.position ? -1 : 1));
    expect(byBoard.map((i) => i.title)).toEqual(TEMPLATE_DETAILS.event.issues.map((i) => i.title));
    expect(issues.every((i) => i.status === 'TODO')).toBe(true);
  });

  test('an unknown template is refused; no template, no issues', async () => {
    expect((await make({ name: 'X', template: 'gardening' })).made.statusCode).toBe(400);
    const { owner, workspace, made } = await make({ name: 'Plain' });
    const listed = await request(
      `/workspaces/${workspace.id}/projects/${made.json().project.id}/issues`,
      { actor: owner },
    );
    expect(listed.json().issues).toHaveLength(0);
  });
});
