import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { issues } from '@robis/database';
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

const NEXT_TWO_WEEKS = { name: 'Cycle 2', startsOn: '2026-12-07', endsOn: '2026-12-20' };

const rollover = (actor: Actor, ws: string, fromId: string, toCycleId: string) =>
  request(`${ws}/cycles/${fromId}/rollover`, { method: 'POST', actor, payload: { toCycleId } });

describe('scope added mid-cycle', () => {
  const addedAt = async (issueId: string) => {
    const { ownerDb } = await getHarness();
    const [row] = await ownerDb
      .select({ at: issues.cycleAddedAt })
      .from(issues)
      .where(eq(issues.id, issueId));
    return row!.at;
  };
  const backdate = async (issueId: string, at: string) => {
    const { ownerDb } = await getHarness();
    await ownerDb
      .update(issues)
      .set({ cycleAddedAt: new Date(at) })
      .where(eq(issues.id, issueId));
  };
  const counted = async (actor: Actor, ws: string, projectId: string) =>
    (await request(`${ws}/projects/${projectId}/cycles`, { actor })).json().cycles[0];

  test('issues put in after its first day, on its own calendar, are counted as added', async () => {
    const { owner, project, ws, file } = await board();
    const cycle = (
      await plan(owner, ws, project.id, { ...TWO_WEEKS, timeZone: 'Europe/London' })
    ).json().cycle;
    const [late, early, edge] = [await file('Late'), await file('Early'), await file('Edge')];
    for (const issue of [late, early, edge]) await put(owner, ws, issue.id, cycle.id);
    // Within its first day in London, and the first moment after it.
    await backdate(early.id, '2026-11-23T23:59:00Z');
    await backdate(edge.id, '2026-11-24T00:00:00Z');
    expect(await counted(owner, ws, project.id)).toMatchObject({ total: 3, added: 2 });
  });

  test('stamped when an issue joins, cleared when it leaves, stamped again on return', async () => {
    const { owner, project, ws, file } = await board();
    const cycle = (await plan(owner, ws, project.id, TWO_WEEKS)).json().cycle;
    const issue = await file('Wanders');
    expect(await addedAt(issue.id)).toBeNull();
    await put(owner, ws, issue.id, cycle.id);
    expect(await addedAt(issue.id)).toBeInstanceOf(Date);
    await backdate(issue.id, '2026-11-23T09:00:00Z');
    // Another edit keeps when it joined.
    await request(`${ws}/issues/${issue.id}`, {
      method: 'PATCH',
      actor: owner,
      payload: { title: 'Still wanders' },
    });
    expect((await addedAt(issue.id))?.toISOString()).toBe('2026-11-23T09:00:00.000Z');
    expect(await counted(owner, ws, project.id)).toMatchObject({ added: 0 });
    await put(owner, ws, issue.id, null);
    expect(await addedAt(issue.id)).toBeNull();
    await put(owner, ws, issue.id, cycle.id);
    expect(await counted(owner, ws, project.id)).toMatchObject({ added: 1 });
  });
  test('left-over work moved into a cycle under way counts as added; removing a cycle clears it', async () => {
    const { owner, project, ws, file } = await board();
    const earlier = (
      await plan(owner, ws, project.id, {
        name: 'Cycle 0',
        startsOn: '2026-11-09',
        endsOn: '2026-11-22',
      })
    ).json().cycle;
    const running = (await plan(owner, ws, project.id, TWO_WEEKS)).json().cycle;
    const issue = await file('Left over');
    await put(owner, ws, issue.id, earlier.id);
    expect((await rollover(owner, ws, earlier.id, running.id)).statusCode).toBe(200);
    const cycles = (await request(`${ws}/projects/${project.id}/cycles`, { actor: owner })).json()
      .cycles as { id: string; added: number }[];
    expect(cycles.find((c) => c.id === running.id)?.added).toBe(1);
    await request(`${ws}/cycles/${running.id}`, { method: 'DELETE', actor: owner });
    expect(await addedAt(issue.id)).toBeNull();
  });
});

describe('how many cycles an issue has been carried through', () => {
  const carried = async (actor: Actor, ws: string, issueId: string) =>
    (await request(`${ws}/issues/${issueId}`, { actor })).json().issue.carriedOver as number;
  const cycleOf = (
    actor: Actor,
    ws: string,
    projectId: string,
    name: string,
    startsOn: string,
    endsOn: string,
  ) =>
    plan(actor, ws, projectId, { name, startsOn, endsOn }).then(
      (r) => r.json().cycle as { id: string },
    );

  test('each move straight from one cycle to another while unfinished adds one', async () => {
    const { owner, project, ws, file } = await board();
    const first = await cycleOf(owner, ws, project.id, 'One', '2026-11-09', '2026-11-22');
    const second = await cycleOf(owner, ws, project.id, 'Two', '2026-11-23', '2026-12-06');
    const third = await cycleOf(owner, ws, project.id, 'Three', '2026-12-07', '2026-12-20');
    const issue = await file('Stubborn');
    expect(await carried(owner, ws, issue.id)).toBe(0);
    await put(owner, ws, issue.id, first.id);
    expect(await carried(owner, ws, issue.id)).toBe(0);
    await rollover(owner, ws, first.id, second.id);
    expect(await carried(owner, ws, issue.id)).toBe(1);
    await put(owner, ws, issue.id, third.id);
    expect(await carried(owner, ws, issue.id)).toBe(2);
    const listed = (await request(`${ws}/projects/${project.id}/issues`, { actor: owner })).json()
      .issues as { id: string; carriedOver: number }[];
    expect(listed.find((row) => row.id === issue.id)?.carriedOver).toBe(2);
  });

  test('not when it was finished, nor when it left and came back', async () => {
    const { owner, project, ws, file } = await board();
    const first = await cycleOf(owner, ws, project.id, 'One', '2026-11-09', '2026-11-22');
    const second = await cycleOf(owner, ws, project.id, 'Two', '2026-11-23', '2026-12-06');
    const [done, wanders] = [await file('Done'), await file('Wanders')];
    for (const issue of [done, wanders]) await put(owner, ws, issue.id, first.id);
    await request(`${ws}/issues/${done.id}`, {
      method: 'PATCH',
      actor: owner,
      payload: { status: 'DONE' },
    });
    await put(owner, ws, done.id, second.id);
    await put(owner, ws, wanders.id, null);
    await put(owner, ws, wanders.id, second.id);
    expect(await carried(owner, ws, done.id)).toBe(0);
    expect(await carried(owner, ws, wanders.id)).toBe(0);
  });

  test('not when one edit finishes it and moves it together', async () => {
    const { owner, project, ws, file } = await board();
    const first = await cycleOf(owner, ws, project.id, 'One', '2026-11-09', '2026-11-22');
    const second = await cycleOf(owner, ws, project.id, 'Two', '2026-11-23', '2026-12-06');
    const issue = await file('Wrapped up');
    await put(owner, ws, issue.id, first.id);
    await request(`${ws}/issues/${issue.id}`, {
      method: 'PATCH',
      actor: owner,
      payload: { status: 'DONE', cycleId: second.id },
    });
    expect(await carried(owner, ws, issue.id)).toBe(0);
  });
});

describe('moving a cycle’s unfinished issues on', () => {
  test('moves what is not done or canceled, and leaves the rest where they were', async () => {
    const { owner, project, ws, file } = await board();
    const first = (await plan(owner, ws, project.id, TWO_WEEKS)).json().cycle;
    const second = (await plan(owner, ws, project.id, NEXT_TWO_WEEKS)).json().cycle;
    const [open, doing, done, dropped, unplanned] = [
      await file('Open'),
      await file('Doing'),
      await file('Done'),
      await file('Dropped'),
      await file('Unplanned'),
    ];
    for (const issue of [open, doing, done, dropped]) await put(owner, ws, issue.id, first.id);
    const status = (issueId: string, value: string) =>
      request(`${ws}/issues/${issueId}`, {
        method: 'PATCH',
        actor: owner,
        payload: { status: value },
      });
    await status(doing.id, 'IN_PROGRESS');
    await status(done.id, 'DONE');
    await status(dropped.id, 'CANCELED');

    const moved = await rollover(owner, ws, first.id, second.id);
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({
      moved: 2,
      cycle: { id: second.id, total: 2, inProgress: 1 },
    });

    const cycleOf = async (issueId: string) =>
      (await request(`${ws}/issues/${issueId}`, { actor: owner })).json().issue.cycleId;
    expect(await cycleOf(open.id)).toBe(second.id);
    expect(await cycleOf(doing.id)).toBe(second.id);
    expect(await cycleOf(done.id)).toBe(first.id);
    expect(await cycleOf(dropped.id)).toBe(first.id);
    expect(await cycleOf(unplanned.id)).toBeNull();

    const again = await rollover(owner, ws, first.id, second.id);
    expect(again.json().moved).toBe(0);
  });

  test('only to another cycle on the same board; a guest cannot move them', async () => {
    const { owner, workspace, project, ws } = await board();
    const first = (await plan(owner, ws, project.id, TWO_WEEKS)).json().cycle;
    const other = await createProject(owner, workspace.id, 'Other');
    const theirs = (await plan(owner, ws, other.id, TWO_WEEKS)).json().cycle;

    const elsewhere = await rollover(owner, ws, first.id, theirs.id);
    expect(elsewhere.statusCode).toBe(400);
    expect(elsewhere.json().error).toBe('bad_cycle');
    const itself = await rollover(owner, ws, first.id, first.id);
    expect(itself.statusCode).toBe(400);
    expect(itself.json().error).toBe('same_cycle');

    const guest = await createActor('Guest');
    await addMember(owner, workspace.id, guest, 'GUEST');
    const second = (await plan(owner, ws, project.id, NEXT_TWO_WEEKS)).json().cycle;
    expect((await rollover(guest, ws, first.id, second.id)).statusCode).toBe(403);
  });

  test('never back into a cycle that ends sooner; an empty cycle moves nothing', async () => {
    const { owner, project, ws, file } = await board();
    const first = (await plan(owner, ws, project.id, TWO_WEEKS)).json().cycle;
    const second = (await plan(owner, ws, project.id, NEXT_TWO_WEEKS)).json().cycle;
    const issue = await file('Open');
    await put(owner, ws, issue.id, second.id);
    const backwards = await rollover(owner, ws, second.id, first.id);
    expect(backwards.statusCode).toBe(400);
    expect(backwards.json().error).toBe('earlier_cycle');
    const empty = await rollover(owner, ws, first.id, second.id);
    expect(empty.json()).toMatchObject({ moved: 0, cycle: { id: second.id, total: 1 } });
  });

  test('a cycle in another workspace is not found', async () => {
    const { owner, project, ws } = await board();
    const first = (await plan(owner, ws, project.id, TWO_WEEKS)).json().cycle;
    const second = (await plan(owner, ws, project.id, NEXT_TWO_WEEKS)).json().cycle;
    const stranger = await createActor('Stranger');
    const theirs = await createWorkspace(stranger);
    const refused = await rollover(stranger, `/workspaces/${theirs.id}`, first.id, second.id);
    expect(refused.statusCode).toBe(404);
  });
});

describe('a cycle’s burn-up', () => {
  const dayFrom = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  test('done by the end of each day so far, out of what is planned', async () => {
    const { owner, workspace, project, ws, file } = await board();
    const cycle = (
      await plan(owner, ws, project.id, { name: 'Now', startsOn: dayFrom(-2), endsOn: dayFrom(9) })
    ).json().cycle;
    const issues = [await file('A'), await file('B'), await file('C'), await file('D')];
    for (const issue of issues) await put(owner, ws, issue.id, cycle.id);
    const set = (issueId: string, status: string) =>
      request(`${ws}/issues/${issueId}`, { method: 'PATCH', actor: owner, payload: { status } });
    await set(issues[0]!.id, 'DONE');
    await set(issues[1]!.id, 'DONE');
    await set(issues[2]!.id, 'CANCELED');

    const guest = await createActor('Guest');
    await addMember(owner, workspace.id, guest, 'GUEST');
    const answer = await request(`${ws}/cycles/${cycle.id}/burnup?timeZone=UTC`, { actor: guest });
    expect(answer.statusCode).toBe(200);
    expect(answer.json() as Record<string, unknown>).toEqual({
      startsOn: dayFrom(-2),
      endsOn: dayFrom(9),
      today: dayFrom(0),
      planned: 3,
      done: [0, 0, 2],
      scope: [0, 0, 3],
    });
  });

  test('what was planned by the end of each day, growing as work joins', async () => {
    const { owner, project, ws, file } = await board();
    const cycle = (
      await plan(owner, ws, project.id, { name: 'Now', startsOn: dayFrom(-2), endsOn: dayFrom(9) })
    ).json().cycle;
    const [early, middle, late] = [await file('Early'), await file('Middle'), await file('Late')];
    for (const issue of [early, middle, late]) await put(owner, ws, issue.id, cycle.id);
    const { ownerDb } = await getHarness();
    const joined = (issueId: string, at: Date | null) =>
      ownerDb.update(issues).set({ cycleAddedAt: at }).where(eq(issues.id, issueId));
    // Planned before this was kept, then one on its second day.
    await joined(early.id, null);
    await joined(middle.id, new Date(`${dayFrom(-1)}T12:00:00Z`));
    const answer = await request(`${ws}/cycles/${cycle.id}/burnup?timeZone=UTC`, { actor: owner });
    expect(answer.json()).toMatchObject({ planned: 3, scope: [1, 2, 3] });
  });

  test('work done before it joined counts as planned from when it was done', async () => {
    const { owner, project, ws, file } = await board();
    const cycle = (
      await plan(owner, ws, project.id, { name: 'Now', startsOn: dayFrom(-2), endsOn: dayFrom(9) })
    ).json().cycle;
    const issue = await file('Already done');
    await request(`${ws}/issues/${issue.id}`, {
      method: 'PATCH',
      actor: owner,
      payload: { status: 'DONE' },
    });
    const { ownerDb } = await getHarness();
    await ownerDb
      .update(issues)
      .set({ completedAt: new Date(`${dayFrom(-2)}T12:00:00Z`) })
      .where(eq(issues.id, issue.id));
    await put(owner, ws, issue.id, cycle.id);
    const answer = (
      await request(`${ws}/cycles/${cycle.id}/burnup?timeZone=UTC`, { actor: owner })
    ).json();
    expect(answer.done).toEqual([1, 1, 1]);
    expect(answer.scope).toEqual([1, 1, 1]);
  });

  test('a zone it does not know is refused; a stranger finds no cycle', async () => {
    const { owner, project, ws } = await board();
    const cycle = (await plan(owner, ws, project.id, TWO_WEEKS)).json().cycle;
    const bad = await request(`${ws}/cycles/${cycle.id}/burnup?timeZone=Not/AZone`, {
      actor: owner,
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('bad_zone');
    const stranger = await createActor('Stranger');
    const theirs = await createWorkspace(stranger);
    const refused = await request(`/workspaces/${theirs.id}/cycles/${cycle.id}/burnup`, {
      actor: stranger,
    });
    expect(refused.statusCode).toBe(404);
  });
});
