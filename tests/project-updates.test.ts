import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { projectUpdates } from '@robis/database';
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
 * Project updates: a member writes how a board is going; everyone reads
 * them, newest first; the feed has each board's latest from the last month;
 * only its author or an admin takes one down; a guest cannot write.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

async function team() {
  const owner = await createActor('Owner');
  const member = await createActor('Member');
  const guest = await createActor('Guest');
  const workspace = await createWorkspace(owner);
  await addMember(owner, workspace.id, member, 'MEMBER');
  await addMember(owner, workspace.id, guest, 'GUEST');
  const project = await createProject(owner, workspace.id);
  return { owner, member, guest, project, ws: `/workspaces/${workspace.id}` };
}

const post = (actor: Actor, ws: string, projectId: string, health: string, body: string) =>
  request(`${ws}/projects/${projectId}/updates`, {
    method: 'POST',
    actor,
    payload: { health, body },
  });

describe('project updates', () => {
  test('written by a member, read newest first, and the latest on the feed', async () => {
    const { member, guest, project, ws } = await team();
    expect((await post(member, ws, project.id, 'on_track', 'Beta is out')).statusCode).toBe(201);
    const second = await post(member, ws, project.id, 'at_risk', 'Payments slipped a week');
    expect(second.json().update).toMatchObject({ health: 'at_risk', authorName: 'Member' });

    const listed = (await request(`${ws}/projects/${project.id}/updates`, { actor: guest })).json();
    expect(listed.updates.map((u: { body: string }) => u.body)).toEqual([
      'Payments slipped a week',
      'Beta is out',
    ]);
    const latest = (await request(`${ws}/project-updates/latest`, { actor: guest })).json();
    expect(latest.updates).toHaveLength(1);
    expect(latest.updates[0]).toMatchObject({ projectId: project.id, health: 'at_risk' });
  });

  test('an update older than a month is not on the feed', async () => {
    const { member, project, ws } = await team();
    const made = (await post(member, ws, project.id, 'on_track', 'Long ago')).json().update;
    const { ownerDb } = await getHarness();
    await ownerDb
      .update(projectUpdates)
      .set({ createdAt: new Date(Date.now() - 40 * 86_400_000) })
      .where(eq(projectUpdates.id, made.id));
    expect(
      (await request(`${ws}/project-updates/latest`, { actor: member })).json().updates,
    ).toEqual([]);
  });

  test('a guest cannot write; only the author or an admin takes one down', async () => {
    const { owner, member, guest, project, ws } = await team();
    expect((await post(guest, ws, project.id, 'on_track', 'Mine')).statusCode).toBe(403);
    const made = (await post(owner, ws, project.id, 'off_track', 'Blocked on legal')).json().update;
    const byMember = await request(`${ws}/project-updates/${made.id}`, {
      method: 'DELETE',
      actor: member,
    });
    expect(byMember.statusCode).toBe(403);
    const byOwner = await request(`${ws}/project-updates/${made.id}`, {
      method: 'DELETE',
      actor: owner,
    });
    expect(byOwner.statusCode).toBe(204);
  });

  test('another workspace’s board and update are not found', async () => {
    const { member, project, ws } = await team();
    const made = (await post(member, ws, project.id, 'on_track', 'Ours')).json().update;
    const other = await createActor('Other');
    const theirs = await createWorkspace(other, 'Theirs');
    expect(
      (await request(`/workspaces/${theirs.id}/projects/${project.id}/updates`, { actor: other }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await request(`/workspaces/${theirs.id}/project-updates/${made.id}`, {
          method: 'DELETE',
          actor: other,
        })
      ).statusCode,
    ).toBe(404);
  });
});
