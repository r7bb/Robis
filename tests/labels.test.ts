import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { auditEvents } from '@robis/database';
import { and, eq } from 'drizzle-orm';
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
 * Labels (C1): a workspace's own, coloured from a fixed palette, set on
 * issues by anyone who may edit them, every change audited.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

async function setUp() {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const project = await createProject(owner, workspace.id);
  const base = `/workspaces/${workspace.id}`;
  const make = (name: string, colour = 'sky', actor = owner) =>
    request(`${base}/labels`, { method: 'POST', actor, payload: { name, colour } });
  const issue = (
    await request(`${base}/projects/${project.id}/issues`, {
      method: 'POST',
      actor: owner,
      payload: { title: 'Labelled' },
    })
  ).json().issue;
  return { owner, workspace, project, base, make, issue };
}

describe('labels', () => {
  test('are made with a colour from the palette, and listed by name', async () => {
    const { owner, base, make } = await setUp();
    expect((await make('Bug', 'rose')).statusCode).toBe(201);
    await make('Accessibility', 'violet');
    expect((await make('Odd', 'chartreuse')).statusCode).toBe(400);
    const { labels } = (await request(`${base}/labels`, { actor: owner })).json();
    expect(labels.map((l: { name: string }) => l.name)).toEqual(['Accessibility', 'Bug']);
  });

  test('names are unique in a workspace, whatever their case', async () => {
    const { make } = await setUp();
    await make('Bug');
    const again = await make('BUG');
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('label_exists');
  });

  test('a guest may not make one', async () => {
    const { owner, workspace, make } = await setUp();
    const guest = await createActor('Guest');
    await addMember(owner, workspace.id, guest, 'GUEST');
    expect((await make('Nope', 'sky', guest)).statusCode).toBe(403);
  });
});

describe('an issue’s labels', () => {
  test('are set exactly, listed with the issue, and audited', async () => {
    const { owner, workspace, project, base, make, issue } = await setUp();
    const bug = (await make('Bug')).json().label;
    const ui = (await make('UI', 'emerald')).json().label;
    const set = await request(`${base}/issues/${issue.id}/labels`, {
      method: 'PUT',
      actor: owner,
      payload: { labelIds: [bug.id, ui.id] },
    });
    expect(set.statusCode).toBe(200);

    const listed = (
      await request(`${base}/projects/${project.id}/issues`, { actor: owner })
    ).json();
    expect(listed.issues[0].labelIds.sort()).toEqual([bug.id, ui.id].sort());

    await request(`${base}/issues/${issue.id}/labels`, {
      method: 'PUT',
      actor: owner,
      payload: { labelIds: [ui.id] },
    });
    const again = (await request(`${base}/projects/${project.id}/issues`, { actor: owner })).json();
    expect(again.issues[0].labelIds).toEqual([ui.id]);

    const { ownerDb } = await getHarness();
    const events = await ownerDb
      .select({ payload: auditEvents.payload })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.workspaceId, workspace.id),
          eq(auditEvents.eventType, 'issue.labels_changed'),
        ),
      );
    expect(events).toHaveLength(2);
  });

  test('another workspace’s label is refused, not attached', async () => {
    const { owner, base, issue } = await setUp();
    const other = await createActor('Other');
    const elsewhere = await createWorkspace(other, 'Elsewhere');
    const theirs = (
      await request(`/workspaces/${elsewhere.id}/labels`, {
        method: 'POST',
        actor: other,
        payload: { name: 'Theirs', colour: 'amber' },
      })
    ).json().label;
    const set = await request(`${base}/issues/${issue.id}/labels`, {
      method: 'PUT',
      actor: owner,
      payload: { labelIds: [theirs.id] },
    });
    expect(set.statusCode).toBe(400);
    expect(set.json().error).toBe('bad_label');
  });

  test('deleting a label takes it off every issue', async () => {
    const { owner, project, base, make, issue } = await setUp();
    const bug = (await make('Bug')).json().label;
    await request(`${base}/issues/${issue.id}/labels`, {
      method: 'PUT',
      actor: owner,
      payload: { labelIds: [bug.id] },
    });
    expect(
      (await request(`${base}/labels/${bug.id}`, { method: 'DELETE', actor: owner })).statusCode,
    ).toBe(204);
    const listed = (
      await request(`${base}/projects/${project.id}/issues`, { actor: owner })
    ).json();
    expect(listed.issues[0].labelIds).toEqual([]);
  });
});
