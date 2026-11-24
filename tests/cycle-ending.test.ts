import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { notificationLine } from '@robis/mailer';
import { notificationHref } from '@robis/web/lib/notification-text.ts';
import { endsTomorrow, runCycleEndingScan } from '@robis/worker/cycle-ending';
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
 * A cycle ending tomorrow (C3 notices): from nine in the morning where it
 * was planned, each person with an issue still open in it hears once, with
 * how many of theirs; nobody else, and nothing from an archived board.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

type Item = {
  kind: string;
  workspaceId: string | null;
  actorName: string | null;
  payload: { cycleId?: string; projectId?: string; title?: string; body?: string };
};

const inbox = async (actor: Actor) =>
  ((await request('/notifications', { actor })).json().notifications as Item[]).filter(
    (item) => item.kind === 'cycle_ending',
  );

async function team() {
  const ana = await createActor('Ana');
  const bo = await createActor('Bo');
  const cy = await createActor('Cy');
  const workspace = await createWorkspace(ana);
  for (const person of [bo, cy]) await addMember(ana, workspace.id, person, 'MEMBER');
  const ws = `/workspaces/${workspace.id}`;
  const project = await createProject(ana, workspace.id, 'Web');
  const plan = async (endsOn: string, timeZone: string, projectId = project.id) =>
    (
      await request(`${ws}/projects/${projectId}/cycles`, {
        method: 'POST',
        actor: ana,
        payload: { name: 'Relaunch', startsOn: '2026-11-12', endsOn, timeZone },
      })
    ).json().cycle as { id: string };
  const file = async (
    cycleId: string,
    assignee: Actor | null,
    status = 'TODO',
    on = project.id,
  ) => {
    const { issue } = (
      await request(`${ws}/projects/${on}/issues`, {
        method: 'POST',
        actor: ana,
        payload: { title: 'Work', status, ...(assignee ? { assigneeId: assignee.id } : {}) },
      })
    ).json();
    await request(`${ws}/issues/${issue.id}`, {
      method: 'PATCH',
      actor: ana,
      payload: { cycleId },
    });
  };
  return { ana, bo, cy, workspace, ws, project, plan, file };
}

const scan = async (now: Date) => runCycleEndingScan((await getHarness()).workerDb, now);

describe('whether a cycle ends tomorrow, on its own clock', () => {
  test('the day before its last day, from nine there', () => {
    const tenUtc = new Date('2026-11-24T10:00:00Z');
    expect(endsTomorrow('2026-11-25', 'UTC', tenUtc)).toBe(true);
    expect(endsTomorrow('2026-11-25', 'UTC', new Date('2026-11-24T08:59:00Z'))).toBe(false);
    expect(endsTomorrow('2026-11-24', 'UTC', tenUtc)).toBe(false);
    // 01:00 in London is already ten on the 24th in Tokyo.
    const oneUtc = new Date('2026-11-24T01:00:00Z');
    expect(endsTomorrow('2026-11-25', 'Asia/Tokyo', oneUtc)).toBe(true);
    expect(endsTomorrow('2026-11-25', 'Europe/London', oneUtc)).toBe(false);
  });
});

describe('telling people a cycle ends tomorrow', () => {
  test('each person with work open in it hears once, with how many and where it leads', async () => {
    const { ana, bo, cy, workspace, project, plan, file } = await team();
    const cycle = await plan('2026-11-25', 'UTC');
    await file(cycle.id, ana);
    await file(cycle.id, ana, 'IN_PROGRESS');
    await file(cycle.id, bo);
    await file(cycle.id, bo, 'DONE');
    await file(cycle.id, cy, 'DONE');
    await file(cycle.id, null);

    await scan(new Date('2026-11-24T10:00:00Z'));
    await scan(new Date('2026-11-24T11:00:00Z'));

    const [anas, ...more] = await inbox(ana);
    expect(more).toEqual([]);
    expect(anas).toMatchObject({
      kind: 'cycle_ending',
      payload: {
        cycleId: cycle.id,
        projectId: project.id,
        title: 'Relaunch',
        body: '2 of your issues are still open on Web.',
      },
    });
    expect((await inbox(bo)).map((item) => item.payload.body)).toEqual([
      'One of your issues is still open on Web.',
    ]);
    expect(await inbox(cy)).toEqual([]);
    expect(notificationHref(anas!)).toBe(
      `/workspaces/${workspace.id}/projects/${project.id}?cycle=${cycle.id}`,
    );
    expect(
      notificationLine({ kind: 'cycle_ending', actor: null, link: 'x', ...anas!.payload }),
    ).toBe('Relaunch ends tomorrow: 2 of your issues are still open on Web.');
  });

  test('a cycle moved to end later is told again; work given later that day is told too', async () => {
    const { ana, bo, ws, plan, file } = await team();
    const cycle = await plan('2026-11-25', 'UTC');
    await file(cycle.id, ana);
    await scan(new Date('2026-11-24T10:00:00Z'));
    expect(await inbox(ana)).toHaveLength(1);
    expect(await inbox(bo)).toEqual([]);

    await file(cycle.id, bo);
    await scan(new Date('2026-11-24T11:00:00Z'));
    expect(await inbox(ana)).toHaveLength(1);
    expect(await inbox(bo)).toHaveLength(1);

    await request(`${ws}/cycles/${cycle.id}`, {
      method: 'PATCH',
      actor: ana,
      payload: { endsOn: '2026-11-27' },
    });
    await scan(new Date('2026-11-26T10:00:00Z'));
    expect(await inbox(ana)).toHaveLength(2);
  });

  test('not before nine where it was planned, and on that clock', async () => {
    const { ana, plan, file } = await team();
    const london = await plan('2026-11-25', 'Europe/London');
    await file(london.id, ana);
    await scan(new Date('2026-11-24T01:00:00Z'));
    expect(await inbox(ana)).toEqual([]);

    const tokyo = await plan('2026-11-25', 'Asia/Tokyo');
    await file(tokyo.id, ana);
    await scan(new Date('2026-11-24T01:00:00Z'));
    expect((await inbox(ana)).map((item) => item.payload.cycleId)).toEqual([tokyo.id]);
  });

  test('nothing from an archived board, and a zone it does not know plans in UTC', async () => {
    const { ana, ws, project, plan, file } = await team();
    const cycle = await plan('2026-11-25', 'Not/AZone');
    await file(cycle.id, ana);
    await request(`${ws}/projects/${project.id}`, {
      method: 'PATCH',
      actor: ana,
      payload: { archived: true },
    });
    await scan(new Date('2026-11-24T10:00:00Z'));
    expect(await inbox(ana)).toEqual([]);

    await request(`${ws}/projects/${project.id}`, {
      method: 'PATCH',
      actor: ana,
      payload: { archived: false },
    });
    await scan(new Date('2026-11-24T10:00:00Z'));
    expect(await inbox(ana)).toHaveLength(1);
  });
});
