import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { auditEvents } from '@robis/database';
import { and, eq } from 'drizzle-orm';
import {
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  getHarness,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * Due dates and sub-issues (C1): a calendar day an issue is due, and a
 * parent in the same project that is never the issue itself or one of its
 * own descendants.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

async function setUp() {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const project = await createProject(owner, workspace.id);
  const base = `/workspaces/${workspace.id}`;
  const file = async (title: string, extra: object = {}, projectId = project.id) =>
    request(`${base}/projects/${projectId}/issues`, {
      method: 'POST',
      actor: owner,
      payload: { title, ...extra },
    });
  const make = async (title: string, extra: object = {}) => (await file(title, extra)).json().issue;
  const patch = (issueId: string, body: object) =>
    request(`${base}/issues/${issueId}`, { method: 'PATCH', actor: owner, payload: body });
  const get = async (issueId: string) =>
    (await request(`${base}/issues/${issueId}`, { actor: owner })).json().issue;
  return { owner, workspace, project, base, file, make, patch, get };
}

describe('a due date', () => {
  test('is a calendar day, set, shown on the list, and cleared', async () => {
    const { project, base, owner, make, patch, get } = await setUp();
    const issue = await make('Ship it', { dueOn: '2026-12-01' });
    expect(issue.dueOn).toBe('2026-12-01');

    await patch(issue.id, { dueOn: '2026-12-24' });
    const listed = (await request(`${base}/projects/${project.id}/issues`, { actor: owner })).json()
      .issues;
    expect(listed[0].dueOn).toBe('2026-12-24');

    await patch(issue.id, { dueOn: null });
    expect((await get(issue.id)).dueOn).toBeNull();
  });

  test('refuses something that is not a day', async () => {
    const { make, patch } = await setUp();
    const issue = await make('Odd date');
    expect((await patch(issue.id, { dueOn: '2026-02-30' })).statusCode).toBe(400);
    expect((await patch(issue.id, { dueOn: 'next friday' })).statusCode).toBe(400);
    expect((await patch(issue.id, { dueOn: '2026-12-01T10:00:00Z' })).statusCode).toBe(400);
  });
});

describe('sub-issues', () => {
  test('a sub-issue names its parent, and the parent lists it', async () => {
    const { make, get } = await setUp();
    const parent = await make('Launch');
    const child = await make('Write the post', { parentId: parent.id });
    const other = await make('Record the demo', { parentId: parent.id });

    const shown = await get(parent.id);
    expect(shown.parent).toBeNull();
    expect(shown.children.map((c: { id: string }) => c.id)).toEqual([child.id, other.id]);
    expect(shown.children[0]).toMatchObject({
      key: child.key,
      title: 'Write the post',
      status: 'TODO',
    });
    expect((await get(child.id)).parent).toMatchObject({ id: parent.id, key: parent.key });
  });

  test('can be moved under another issue, or set free, audited as a change', async () => {
    const { workspace, make, patch, get } = await setUp();
    const a = await make('A');
    const b = await make('B');
    expect((await patch(b.id, { parentId: a.id })).json().issue.parentId).toBe(a.id);
    expect((await patch(b.id, { parentId: null })).json().issue.parentId).toBeNull();
    expect((await get(a.id)).children).toEqual([]);

    const { ownerDb } = await getHarness();
    const events = await ownerDb
      .select({ payload: auditEvents.payload })
      .from(auditEvents)
      .where(and(eq(auditEvents.workspaceId, workspace.id), eq(auditEvents.entityId, b.id)));
    const fields = events.flatMap(
      (e) => (JSON.parse(e.payload) as { fields?: string[] }).fields ?? [],
    );
    expect(fields.filter((f) => f === 'parentId')).toHaveLength(2);
  });

  test('is never its own parent, nor its descendant’s child', async () => {
    const { make, patch } = await setUp();
    const top = await make('Top');
    const middle = await make('Middle', { parentId: top.id });
    const bottom = await make('Bottom', { parentId: middle.id });

    const self = await patch(top.id, { parentId: top.id });
    expect(self.statusCode).toBe(400);
    expect(self.json().error).toBe('parent_cycle');
    const loop = await patch(top.id, { parentId: bottom.id });
    expect(loop.statusCode).toBe(400);
    expect(loop.json().error).toBe('parent_cycle');
  });

  test('stays in its parent’s project, and its workspace', async () => {
    const { owner, workspace, make, file, patch } = await setUp();
    const parent = await make('Here');
    const elsewhere = await createProject(owner, workspace.id, 'Elsewhere');
    const refused = await file('There', { parentId: parent.id }, elsewhere.id);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toBe('parent_other_project');

    const stranger = await createActor('Stranger');
    const theirs = await createWorkspace(stranger);
    const theirProject = await createProject(stranger, theirs.id);
    const foreign = (
      await request(`/workspaces/${theirs.id}/projects/${theirProject.id}/issues`, {
        method: 'POST',
        actor: stranger,
        payload: { title: 'Not yours' },
      })
    ).json().issue;
    const child = await make('Mine');
    const crossed = await patch(child.id, { parentId: foreign.id });
    expect(crossed.statusCode).toBe(400);
    expect(crossed.json().error).toBe('bad_parent');
  });

  test('stand on their own when the parent is deleted', async () => {
    const { base, owner, make, get } = await setUp();
    const parent = await make('Going away');
    const child = await make('Staying', { parentId: parent.id });
    await request(`${base}/issues/${parent.id}`, { method: 'DELETE', actor: owner });
    const after = await get(child.id);
    expect(after.parentId).toBeNull();
    expect(after.parent).toBeNull();
  });
});

describe('sub-issues, at their limits', () => {
  test('two opposite moves at once cannot make a loop', async () => {
    const { make, patch } = await setUp();
    const a = await make('A');
    const b = await make('B');
    const [one, two] = await Promise.all([
      patch(a.id, { parentId: b.id }),
      patch(b.id, { parentId: a.id }),
    ]);
    const codes = [one.statusCode, two.statusCode].sort();
    expect(codes).toEqual([200, 400]);
    const refused = one.statusCode === 400 ? one : two;
    expect(refused.json().error).toBe('parent_cycle');
  });

  test('a tree goes at most 50 deep', async () => {
    const { make, file } = await setUp();
    let parent = await make('Level 1');
    for (let level = 2; level <= 49; level++) {
      parent = await make(`Level ${level}`, { parentId: parent.id });
    }
    // Level 50 is the deepest an issue may sit; one more is refused.
    const fiftieth = await file('Level 50', { parentId: parent.id });
    expect(fiftieth.statusCode).toBe(201);
    const tooDeep = await file('Level 51', { parentId: fiftieth.json().issue.id });
    expect(tooDeep.statusCode).toBe(400);
    expect(tooDeep.json().error).toBe('parent_too_deep');
  });
});

describe('a due date, at its limits', () => {
  test('refuses a year no calendar here uses', async () => {
    const { make, patch } = await setUp();
    const issue = await make('Far off');
    expect((await patch(issue.id, { dueOn: '0000-01-01' })).statusCode).toBe(400);
    expect((await patch(issue.id, { dueOn: '2999-12-31' })).statusCode).toBe(200);
  });
});
