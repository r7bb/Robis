import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { isHeavy, medianOpen } from '@robis/api/workload';
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
 * Workload: each person's open issues, everyone listed (the idle too), and
 * someone called heavy only when well above the team and above a floor.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

describe('who is heavy', () => {
  test('the median is the team’s, the idle counted', () => {
    expect(medianOpen([])).toBe(0);
    expect(medianOpen([{ open: 1 }, { open: 9 }, { open: 2 }])).toBe(2);
    expect(medianOpen([{ open: 0 }, { open: 4 }])).toBe(2);
  });

  test('well above the team and over the floor, and not otherwise', () => {
    expect(isHeavy(8, 2)).toBe(true);
    // Three among people with one: not buried, under the floor.
    expect(isHeavy(3, 1)).toBe(false);
    // Everyone busy: nobody stands out.
    expect(isHeavy(9, 8)).toBe(false);
    // A team with nothing open: five is heavy against a median of nought.
    expect(isHeavy(5, 0)).toBe(true);
  });
});

describe('the workload', () => {
  test('open issues per person by state, most first, the idle listed and agents not', async () => {
    const ana = await createActor('Ana');
    const bo = await createActor('Bo');
    const cy = await createActor('Cy');
    const workspace = await createWorkspace(ana);
    for (const person of [bo, cy]) await addMember(ana, workspace.id, person, 'MEMBER');
    const ws = `/workspaces/${workspace.id}`;
    const project = await createProject(ana, workspace.id);
    const file = (actor: Actor, payload: Record<string, unknown>) =>
      request(`${ws}/projects/${project.id}/issues`, { method: 'POST', actor, payload });
    const today = '2026-11-24';
    for (let i = 0; i < 6; i++) await file(ana, { title: `Bo ${i}`, assigneeId: bo.id });
    await file(ana, {
      title: 'Bo urgent',
      assigneeId: bo.id,
      priority: 'URGENT',
      dueOn: '2026-11-20',
    });
    await file(ana, {
      title: 'Bo soon',
      assigneeId: bo.id,
      dueOn: '2026-11-26',
      status: 'IN_PROGRESS',
    });
    await file(ana, { title: 'Ana one', assigneeId: ana.id });
    await file(ana, { title: 'Ana done', assigneeId: ana.id, status: 'DONE' });

    const load = (await request(`${ws}/insights/workload?today=${today}`, { actor: cy })).json();
    expect(load.medianOpen).toBe(1);
    expect(load.people).toEqual([
      {
        userId: bo.id,
        name: 'Bo',
        open: 8,
        inProgress: 1,
        overdue: 1,
        dueSoon: 1,
        urgent: 1,
        heavy: true,
      },
      {
        userId: ana.id,
        name: 'Ana',
        open: 1,
        inProgress: 0,
        overdue: 0,
        dueSoon: 0,
        urgent: 0,
        heavy: false,
      },
      {
        userId: cy.id,
        name: 'Cy',
        open: 0,
        inProgress: 0,
        overdue: 0,
        dueSoon: 0,
        urgent: 0,
        heavy: false,
      },
    ]);
  });

  test('in running cycles only: what is planned now, not the backlog or an ended cycle', async () => {
    const ana = await createActor('Ana');
    const bo = await createActor('Bo');
    const workspace = await createWorkspace(ana);
    await addMember(ana, workspace.id, bo, 'MEMBER');
    const ws = `/workspaces/${workspace.id}`;
    const project = await createProject(ana, workspace.id);
    const plan = async (name: string, startsOn: string, endsOn: string) =>
      (
        await request(`${ws}/projects/${project.id}/cycles`, {
          method: 'POST',
          actor: ana,
          payload: { name, startsOn, endsOn },
        })
      ).json().cycle as { id: string };
    const now = await plan('Now', '2026-11-16', '2026-11-29');
    const ended = await plan('Ended', '2026-11-02', '2026-11-15');
    const file = async (assigneeId: string, cycleId: string | null) => {
      const { issue } = (
        await request(`${ws}/projects/${project.id}/issues`, {
          method: 'POST',
          actor: ana,
          payload: { title: 'Work', assigneeId },
        })
      ).json();
      if (cycleId) {
        await request(`${ws}/issues/${issue.id}`, {
          method: 'PATCH',
          actor: ana,
          payload: { cycleId },
        });
      }
    };
    await file(bo.id, now.id);
    await file(bo.id, null);
    await file(bo.id, ended.id);
    await file(ana.id, now.id);
    await file(ana.id, now.id);

    const everything = (
      await request(`${ws}/insights/workload?today=2026-11-24`, { actor: ana })
    ).json();
    expect(everything.people.map((p: { name: string; open: number }) => [p.name, p.open])).toEqual([
      ['Bo', 3],
      ['Ana', 2],
    ]);
    const planned = (
      await request(`${ws}/insights/workload?today=2026-11-24&scope=cycles`, { actor: ana })
    ).json();
    expect(planned.people.map((p: { name: string; open: number }) => [p.name, p.open])).toEqual([
      ['Ana', 2],
      ['Bo', 1],
    ]);
  });

  test('another workspace’s is not found', async () => {
    const ana = await createActor('Ana');
    const workspace = await createWorkspace(ana);
    const other = await createActor('Other');
    expect(
      (await request(`/workspaces/${workspace.id}/insights/workload`, { actor: other })).statusCode,
    ).toBe(404);
  });
});
