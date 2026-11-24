import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { runDueRepeats } from '@robis/api/repeats-run';
import { issues, recurringIssues, workspaceMembers } from '@robis/database';
import { and, eq } from 'drizzle-orm';
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
 * Repeats: an issue filed on a schedule, once each time it is due, as its
 * creator; paused ones wait, and one whose creator left pauses itself.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const WEEKLY = {
  title: 'Weekly release check',
  description: null,
  priority: 'HIGH',
  assigneeId: null,
  cadence: 'weekly',
  weekday: 1,
  monthDay: null,
  hour: 9,
  timeZone: 'Europe/London',
};

async function board() {
  const owner = await createActor('Owner');
  const member = await createActor('Member');
  const workspace = await createWorkspace(owner);
  await addMember(owner, workspace.id, member, 'MEMBER');
  const project = await createProject(owner, workspace.id);
  const ws = `/workspaces/${workspace.id}`;
  return { owner, member, workspace, project, ws };
}

const make = (actor: Actor, ws: string, projectId: string, body: Record<string, unknown>) =>
  request(`${ws}/projects/${projectId}/repeats`, { method: 'POST', actor, payload: body });

async function dueNow(repeatId: string) {
  const { ownerDb } = await getHarness();
  await ownerDb
    .update(recurringIssues)
    .set({ nextRunAt: new Date(Date.now() - 1000) })
    .where(eq(recurringIssues.id, repeatId));
}

async function filedOn(projectId: string) {
  const { ownerDb } = await getHarness();
  return ownerDb.select().from(issues).where(eq(issues.projectId, projectId));
}

describe('repeats', () => {
  test('set up with its next run on its own clock, and listed', async () => {
    const { member, project, ws } = await board();
    const made = await make(member, ws, project.id, { ...WEEKLY, assigneeId: member.id });
    expect(made.statusCode).toBe(201);
    const repeat = made.json().repeat;
    expect(repeat).toMatchObject({
      title: 'Weekly release check',
      cadence: 'weekly',
      paused: false,
    });
    const next = new Date(repeat.nextRunAt);
    expect(next.getTime()).toBeGreaterThan(Date.now());
    // Monday, at nine in London.
    expect(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        weekday: 'short',
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(next),
    ).toBe('Mon, 09');
    const listed = (
      await request(`${ws}/projects/${project.id}/repeats`, { actor: member })
    ).json();
    expect(listed.repeats.map((r: { id: string }) => r.id)).toEqual([repeat.id]);
  });

  test('when due, files the issue once, as its creator, and moves on', async () => {
    const { member, project, ws } = await board();
    const repeat = (await make(member, ws, project.id, { ...WEEKLY, assigneeId: member.id })).json()
      .repeat;
    await dueNow(repeat.id);
    const { db } = await getHarness();
    expect(await runDueRepeats(db)).toBe(1);
    expect(await runDueRepeats(db)).toBe(0);
    const filed = await filedOn(project.id);
    expect(filed).toHaveLength(1);
    expect(filed[0]).toMatchObject({
      title: 'Weekly release check',
      priority: 'HIGH',
      assigneeId: member.id,
      createdBy: member.id,
    });
    const [after] = await db
      .select()
      .from(recurringIssues)
      .where(eq(recurringIssues.id, repeat.id));
    expect(after!.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    expect(after!.lastRunAt).not.toBeNull();
  });

  test('paused waits; resumed, it is due next time, not at once', async () => {
    const { member, project, ws } = await board();
    const repeat = (await make(member, ws, project.id, WEEKLY)).json().repeat;
    const paused = await request(`${ws}/repeats/${repeat.id}`, {
      method: 'PATCH',
      actor: member,
      payload: { paused: true },
    });
    expect(paused.json().repeat.paused).toBe(true);
    await dueNow(repeat.id);
    const { db } = await getHarness();
    expect(await runDueRepeats(db)).toBe(0);
    const resumed = await request(`${ws}/repeats/${repeat.id}`, {
      method: 'PATCH',
      actor: member,
      payload: { paused: false },
    });
    expect(new Date(resumed.json().repeat.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    expect(await runDueRepeats(db)).toBe(0);
  });

  test('one whose creator left pauses itself and files nothing', async () => {
    const { member, workspace, project, ws } = await board();
    const repeat = (await make(member, ws, project.id, WEEKLY)).json().repeat;
    await dueNow(repeat.id);
    const { ownerDb, db } = await getHarness();
    await ownerDb
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, member.id)),
      );
    await runDueRepeats(db);
    expect(await filedOn(project.id)).toEqual([]);
    const [after] = await db
      .select()
      .from(recurringIssues)
      .where(eq(recurringIssues.id, repeat.id));
    expect(after!.paused).toBe(true);
  });

  test('only its creator or an admin changes it; a guest cannot set one up; a weekly one needs its day', async () => {
    const { owner, member, workspace, project, ws } = await board();
    const repeat = (await make(owner, ws, project.id, WEEKLY)).json().repeat;
    const byMember = await request(`${ws}/repeats/${repeat.id}`, {
      method: 'DELETE',
      actor: member,
    });
    expect(byMember.statusCode).toBe(403);
    const guest = await createActor('Guest');
    await addMember(owner, workspace.id, guest, 'GUEST');
    expect((await make(guest, ws, project.id, WEEKLY)).statusCode).toBe(403);
    expect((await make(owner, ws, project.id, { ...WEEKLY, weekday: null })).statusCode).toBe(400);
    expect(
      (await request(`${ws}/repeats/${repeat.id}`, { method: 'DELETE', actor: owner })).statusCode,
    ).toBe(204);
  });
});

describe('repeats, as people come and go', () => {
  test('a creator no longer allowed to file issues pauses the repeat', async () => {
    const { owner, member, workspace, project, ws } = await board();
    const repeat = (await make(member, ws, project.id, WEEKLY)).json().repeat;
    await request(`/workspaces/${workspace.id}/members/${member.id}`, {
      method: 'PATCH',
      actor: owner,
      payload: { role: 'GUEST' },
    });
    await dueNow(repeat.id);
    const { db } = await getHarness();
    await runDueRepeats(db);
    expect(await filedOn(project.id)).toEqual([]);
    const [after] = await db
      .select()
      .from(recurringIssues)
      .where(eq(recurringIssues.id, repeat.id));
    expect(after!.paused).toBe(true);
  });

  test('an assignee who has left is not given the new issue', async () => {
    const { owner, member, workspace, project, ws } = await board();
    const repeat = (await make(owner, ws, project.id, { ...WEEKLY, assigneeId: member.id })).json()
      .repeat;
    const { ownerDb, db } = await getHarness();
    await ownerDb
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, member.id)),
      );
    await dueNow(repeat.id);
    await runDueRepeats(db);
    const [filed] = await filedOn(project.id);
    expect(filed).toMatchObject({ title: 'Weekly release check', assigneeId: null });
  });
});
