import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  addMember,
  closeHarness,
  createActor,
  createWorkspace,
  request,
  resetDatabase,
} from './harness.ts';

beforeEach(resetDatabase);
afterAll(closeHarness);

type Actor = Awaited<ReturnType<typeof createActor>>;

const HOUR = 60 * 60_000;
const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * HOUR);

async function schedule(
  actor: Actor,
  workspaceId: string,
  title: string,
  startsAt: Date,
  attendeeIds: string[] = [],
  durationMinutes = 30,
) {
  const made = await request(`/workspaces/${workspaceId}/meetings`, {
    method: 'POST',
    payload: { title, startsAt: startsAt.toISOString(), durationMinutes, attendeeIds },
    actor,
  });
  expect(made.statusCode).toBe(201);
  return made.json().meeting as { id: string };
}

function mine(actor: Actor, from: Date, to: Date) {
  const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  return request(`/me/meetings?${query}`, { actor });
}

describe('my meetings across workspaces', () => {
  test('the ones I am in, in every workspace, soonest first, with the workspace', async () => {
    const owner = await createActor('Owner');
    const me = await createActor('Me');
    const first = await createWorkspace(owner, 'First');
    const second = await createWorkspace(owner, 'Second');
    await addMember(owner, first.id, me, 'MEMBER');
    await addMember(owner, second.id, me, 'MEMBER');

    await schedule(owner, second.id, 'Later', at(3), [me.id]);
    await schedule(owner, first.id, 'Sooner', at(1), [me.id]);
    await schedule(owner, first.id, 'Not mine', at(2));

    const response = await mine(me, at(0), at(12));
    expect(response.statusCode).toBe(200);
    const meetings = response.json().meetings;
    expect(meetings.map((m: { title: string }) => m.title)).toEqual(['Sooner', 'Later']);
    expect(meetings[0].workspaceName).toBe('First');
    expect(meetings[1].workspaceName).toBe('Second');
    expect(meetings[0].myResponse).toBe('pending');
  });

  test('the organiser sees their own, already said yes', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    await schedule(owner, workspace.id, 'Mine', at(1));

    const meetings = (await mine(owner, at(0), at(2))).json().meetings;
    expect(meetings).toHaveLength(1);
    expect(meetings[0].myResponse).toBe('yes');
  });

  test('one under way counts; one outside the window or called off does not', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    await schedule(owner, workspace.id, 'Under way', at(-0.25), [], 60);
    await schedule(owner, workspace.id, 'Tomorrow', at(30));
    const off = await schedule(owner, workspace.id, 'Called off', at(1));
    const canceled = await request(`/workspaces/${workspace.id}/meetings/${off.id}`, {
      method: 'DELETE',
      actor: owner,
    });
    expect(canceled.statusCode).toBeLessThan(300);

    const meetings = (await mine(owner, at(0), at(12))).json().meetings;
    expect(meetings.map((m: { title: string }) => m.title)).toEqual(['Under way']);
  });

  test('a workspace I have left shows nothing', async () => {
    const owner = await createActor('Owner');
    const me = await createActor('Me');
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id, me, 'MEMBER');
    await schedule(owner, workspace.id, 'Planning', at(1), [me.id]);
    const removed = await request(`/workspaces/${workspace.id}/members/${me.id}`, {
      method: 'DELETE',
      actor: owner,
    });
    expect(removed.statusCode).toBeLessThan(300);

    expect((await mine(me, at(0), at(12))).json().meetings).toHaveLength(0);
  });

  test('a window backwards, longer than two days, or not a date is refused', async () => {
    const owner = await createActor('Owner');
    expect((await mine(owner, at(2), at(1))).statusCode).toBe(400);
    expect((await mine(owner, at(0), at(49))).statusCode).toBe(400);
    const bad = await request('/me/meetings?from=yesterday&to=today', { actor: owner });
    expect(bad.statusCode).toBe(400);
  });

  test('signed out, it is a 401', async () => {
    const query = new URLSearchParams({ from: at(0).toISOString(), to: at(1).toISOString() });
    expect((await request(`/me/meetings?${query}`)).statusCode).toBe(401);
  });
});
