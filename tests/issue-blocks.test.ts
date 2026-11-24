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
 * Blocked by: an issue waits on another in its workspace, never itself and
 * never round a loop; a board knows which of its issues still wait, until
 * what they wait on is done; a guest may look but not link.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

type Related = { id: string; key: string; title: string; status: string };
type Blocks = { blockedBy: Related[]; blocking: Related[] };

async function board() {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const project = await createProject(owner, workspace.id);
  const ws = `/workspaces/${workspace.id}`;
  const file = async (title: string) => {
    const made = await request(`${ws}/projects/${project.id}/issues`, {
      method: 'POST',
      actor: owner,
      payload: { title },
    });
    return made.json().issue as { id: string };
  };
  return { owner, workspace, project, ws, file };
}

const link = (actor: Actor, ws: string, issueId: string, blockerId: string) =>
  request(`${ws}/issues/${issueId}/blocked-by`, { method: 'POST', actor, payload: { blockerId } });

describe('blocked by', () => {
  test('both sides list the link, and the board knows what still waits', async () => {
    const { owner, project, ws, file } = await board();
    const api = await file('Ship the API');
    const ui = await file('Ship the screen');
    const made = await link(owner, ws, ui.id, api.id);
    expect(made.statusCode).toBe(201);
    expect(made.json<Blocks>().blockedBy.map((r) => r.title)).toEqual(['Ship the API']);
    const other = (await request(`${ws}/issues/${api.id}/blocks`, { actor: owner })).json<Blocks>();
    expect(other.blocking.map((r) => r.id)).toEqual([ui.id]);

    const waiting = () =>
      request(`${ws}/projects/${project.id}/blocked`, { actor: owner }).then(
        (r) => r.json<{ issueIds: string[] }>().issueIds,
      );
    expect(await waiting()).toEqual([ui.id]);
    await request(`${ws}/issues/${api.id}`, {
      method: 'PATCH',
      actor: owner,
      payload: { status: 'DONE' },
    });
    expect(await waiting()).toEqual([]);

    const removed = await request(`${ws}/issues/${ui.id}/blocked-by/${api.id}`, {
      method: 'DELETE',
      actor: owner,
    });
    expect(removed.json<Blocks>().blockedBy).toEqual([]);
  });

  test('never itself, and never round a loop however far', async () => {
    const { owner, ws, file } = await board();
    const [a, b, c] = [await file('A'), await file('B'), await file('C')];
    const self = await link(owner, ws, a.id, a.id);
    expect(self.statusCode).toBe(400);
    expect(self.json<{ error: string }>().error).toBe('self');
    expect((await link(owner, ws, b.id, a.id)).statusCode).toBe(201);
    expect((await link(owner, ws, c.id, b.id)).statusCode).toBe(201);
    const loop = await link(owner, ws, a.id, c.id);
    expect(loop.statusCode).toBe(409);
    expect(loop.json<{ error: string }>().error).toBe('blocks_loop');
    // Linking twice is one link.
    expect((await link(owner, ws, b.id, a.id)).json<Blocks>().blockedBy).toHaveLength(1);
  });

  test('another workspace’s issue is not found, and a guest may look but not link', async () => {
    const { owner, workspace, ws, file } = await board();
    const mine = await file('Mine');
    const stranger = await createActor('Stranger');
    const theirs = await createWorkspace(stranger, 'Theirs');
    const theirProject = await createProject(stranger, theirs.id);
    const foreign = (
      await request(`/workspaces/${theirs.id}/projects/${theirProject.id}/issues`, {
        method: 'POST',
        actor: stranger,
        payload: { title: 'Theirs' },
      })
    ).json().issue as { id: string };
    expect((await link(owner, ws, mine.id, foreign.id)).statusCode).toBe(404);

    const guest = await createActor('Guest');
    await addMember(owner, workspace.id, guest, 'GUEST');
    const other = await file('Other');
    expect((await link(guest, ws, mine.id, other.id)).statusCode).toBe(403);
    expect((await request(`${ws}/issues/${mine.id}/blocks`, { actor: guest })).statusCode).toBe(
      200,
    );
  });
});
