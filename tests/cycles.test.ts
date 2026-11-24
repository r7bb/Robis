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
 * Cycles: a board plans its work in stretches of days; an issue is planned
 * for one of its own board's cycles only; each cycle counts how its issues
 * stand; removing one leaves its issues unplanned.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const TWO_WEEKS = { name: 'Cycle 1', startsOn: '2026-11-23', endsOn: '2026-12-06' };

async function board() {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const project = await createProject(owner, workspace.id);
  const ws = `/workspaces/${workspace.id}`;
  const file = async (title: string) =>
    (
      await request(`${ws}/projects/${project.id}/issues`, {
        method: 'POST',
        actor: owner,
        payload: { title },
      })
    ).json().issue as { id: string };
  return { owner, workspace, project, ws, file };
}

const plan = (actor: Actor, ws: string, projectId: string, body: Record<string, unknown>) =>
  request(`${ws}/projects/${projectId}/cycles`, { method: 'POST', actor, payload: body });

const put = (actor: Actor, ws: string, issueId: string, cycleId: string | null) =>
  request(`${ws}/issues/${issueId}`, { method: 'PATCH', actor, payload: { cycleId } });

describe('cycles', () => {
  test('planned, issues put in it, counted, and listed by it', async () => {
    const { owner, project, ws, file } = await board();
    const made = await plan(owner, ws, project.id, TWO_WEEKS);
    expect(made.statusCode).toBe(201);
    const cycle = made.json().cycle;
    const [a, b, c] = [await file('A'), await file('B'), await file('C')];
    for (const issue of [a, b])
      expect((await put(owner, ws, issue.id, cycle.id)).statusCode).toBe(200);
    await request(`${ws}/issues/${a.id}`, {
      method: 'PATCH',
      actor: owner,
      payload: { status: 'DONE' },
    });

    const listed = (await request(`${ws}/projects/${project.id}/cycles`, { actor: owner })).json();
    expect(listed.cycles).toEqual([
      expect.objectContaining({ id: cycle.id, name: 'Cycle 1', total: 2, done: 1, canceled: 0 }),
    ]);
    const inIt = (
      await request(`${ws}/projects/${project.id}/issues?cycleId=${cycle.id}`, { actor: owner })
    ).json();
    expect(inIt.issues.map((i: { id: string }) => i.id).sort()).toEqual([a.id, b.id].sort());
    expect(inIt.issues[0].cycleId).toBe(cycle.id);
    expect(c.id).toBeTruthy();
  });

  test('days that end before they start, or run past eight weeks, are refused', async () => {
    const { owner, project, ws } = await board();
    const backwards = await plan(owner, ws, project.id, { ...TWO_WEEKS, endsOn: '2026-11-01' });
    expect(backwards.json().error).toBe('bad_dates');
    const long = await plan(owner, ws, project.id, { ...TWO_WEEKS, endsOn: '2027-03-01' });
    expect(long.json().error).toBe('too_long');
  });

  test('an issue is planned only for its own board’s cycle', async () => {
    const { owner, workspace, ws, file } = await board();
    const other = await createProject(owner, workspace.id, 'Other');
    const theirs = (await plan(owner, ws, other.id, TWO_WEEKS)).json().cycle;
    const issue = await file('Mine');
    const refused = await put(owner, ws, issue.id, theirs.id);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toBe('bad_cycle');
  });

  test('removing a cycle leaves its issues unplanned; a guest cannot plan', async () => {
    const { owner, workspace, project, ws, file } = await board();
    const cycle = (await plan(owner, ws, project.id, TWO_WEEKS)).json().cycle;
    const issue = await file('Planned');
    await put(owner, ws, issue.id, cycle.id);
    expect(
      (await request(`${ws}/cycles/${cycle.id}`, { method: 'DELETE', actor: owner })).statusCode,
    ).toBe(204);
    const after = (await request(`${ws}/issues/${issue.id}`, { actor: owner })).json();
    expect(after.issue.cycleId).toBeNull();

    const guest = await createActor('Guest');
    await addMember(owner, workspace.id, guest, 'GUEST');
    expect((await plan(guest, ws, project.id, TWO_WEEKS)).statusCode).toBe(403);
  });
});
