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
 * The cycles running today across a workspace's boards, for Sapha's "how is
 * the cycle going": each with its counts and the first few issues still
 * open, work under way first; ended, future and archived boards' cycles
 * left out; today as the asker reckons it.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const TODAY = '2026-11-24';

async function setUp() {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const ws = `/workspaces/${workspace.id}`;
  const plan = (projectId: string, name: string, startsOn: string, endsOn: string) =>
    request(`${ws}/projects/${projectId}/cycles`, {
      method: 'POST',
      actor: owner,
      payload: { name, startsOn, endsOn },
    }).then((r) => r.json().cycle as { id: string });
  const file = async (projectId: string, title: string, cycleId: string, status = 'TODO') => {
    const { issue } = (
      await request(`${ws}/projects/${projectId}/issues`, {
        method: 'POST',
        actor: owner,
        payload: { title, status },
      })
    ).json();
    await request(`${ws}/issues/${issue.id}`, {
      method: 'PATCH',
      actor: owner,
      payload: { cycleId },
    });
    return issue as { id: string };
  };
  const current = (today?: string, actor = owner) =>
    request(`${ws}/cycles/current${today ? `?today=${today}` : ''}`, { actor });
  return { owner, workspace, ws, plan, file, current };
}

describe('the cycles running today', () => {
  test('each board’s running cycle, its counts and what is left, under way first', async () => {
    const { owner, workspace, plan, file, current } = await setUp();
    const web = await createProject(owner, workspace.id, 'Web');
    const app = await createProject(owner, workspace.id, 'App');
    const running = await plan(web.id, 'Relaunch', '2026-11-16', '2026-11-29');
    await plan(web.id, 'Earlier', '2026-11-02', '2026-11-15');
    await plan(web.id, 'Later', '2026-11-30', '2026-12-13');
    const appCycle = await plan(app.id, 'App cycle', '2026-11-23', '2026-11-24');
    await file(web.id, 'Not started', running.id);
    await file(web.id, 'Shipped', running.id, 'DONE');
    await file(web.id, 'Being read', running.id, 'IN_REVIEW');
    await file(web.id, 'Under way', running.id, 'IN_PROGRESS');
    await file(app.id, 'App work', appCycle.id);

    const answer = await current(TODAY);
    expect(answer.statusCode).toBe(200);
    const listed = answer.json().cycles;
    expect(listed.map((c: { name: string }) => c.name)).toEqual(['App cycle', 'Relaunch']);
    expect(listed[1]).toMatchObject({ projectName: 'Web', total: 4, done: 1, inProgress: 2 });
    expect(listed[1].open.map((i: { title: string }) => i.title)).toEqual([
      'Being read',
      'Under way',
      'Not started',
    ]);
    expect(listed[1].open[0].key).toMatch(/^[A-Z0-9]+-\d+$/);
  });

  test('today is the asker’s: the next cycle once it has started', async () => {
    const { owner, workspace, plan, current } = await setUp();
    const web = await createProject(owner, workspace.id, 'Web');
    await plan(web.id, 'Later', '2026-11-30', '2026-12-13');
    expect((await current(TODAY)).json().cycles).toEqual([]);
    const then = (await current('2026-11-30')).json().cycles;
    expect(then.map((c: { name: string }) => c.name)).toEqual(['Later']);
  });

  test('an archived board’s cycle is left out; a guest reads it; a stranger cannot', async () => {
    const { owner, workspace, ws, plan, current } = await setUp();
    const old = await createProject(owner, workspace.id, 'Old');
    await plan(old.id, 'Old cycle', '2026-11-16', '2026-11-29');
    const web = await createProject(owner, workspace.id, 'Web');
    await plan(web.id, 'Relaunch', '2026-11-16', '2026-11-29');
    await request(`${ws}/projects/${old.id}`, {
      method: 'PATCH',
      actor: owner,
      payload: { archived: true },
    });
    const guest = await createActor('Guest');
    await addMember(owner, workspace.id, guest, 'GUEST');
    const seen = (await current(TODAY, guest)).json().cycles;
    expect(seen.map((c: { name: string }) => c.name)).toEqual(['Relaunch']);

    const stranger = await createActor('Stranger');
    expect((await current(TODAY, stranger)).statusCode).toBe(404);
    expect((await current('not-a-day')).statusCode).toBe(400);
  });
});
