import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { healthOf, todayFor, worthShowing } from '@robis/api/feed-health';
import { issues } from '@robis/database';
import { eq } from 'drizzle-orm';
import {
  type Actor,
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  getHarness,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * Project health on the Feed (Phase 2c). Done when: each active project's
 * numbers come from its issues, its state follows the written rules, done
 * is stamped by the database whichever way an issue gets there, and only
 * members who may read issues see any of it.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

type Health = {
  key: string;
  state: string;
  open: number;
  done: number;
  doneRecently: number;
  openedRecently: number;
  overdue: number;
  urgent: number;
};

async function file(actor: Actor, workspaceId: string, projectId: string, fields = {}) {
  const made = await request(`/workspaces/${workspaceId}/projects/${projectId}/issues`, {
    method: 'POST',
    actor,
    payload: { title: 'A piece of work', ...fields },
  });
  expect(made.statusCode).toBe(201);
  return made.json().issue.id as string;
}

const move = (actor: Actor, workspaceId: string, issueId: string, status: string) =>
  request(`/workspaces/${workspaceId}/issues/${issueId}`, {
    method: 'PATCH',
    actor,
    payload: { status },
  });

async function healthOfAll(actor: Actor, workspaceId: string): Promise<Health[]> {
  const reply = await request(`/workspaces/${workspaceId}/feed/projects`, { actor });
  expect(reply.statusCode).toBe(200);
  return reply.json().projects;
}

async function completedAt(issueId: string) {
  const { ownerDb } = await getHarness();
  const [row] = await ownerDb
    .select({ at: issues.completedAt })
    .from(issues)
    .where(eq(issues.id, issueId));
  return row?.at ?? null;
}

describe('done is a moment the database keeps', () => {
  test('stamped on the way to done, kept while done, cleared on the way out', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const project = await createProject(owner, workspace.id);
    const id = await file(owner, workspace.id, project.id);
    expect(await completedAt(id)).toBeNull();

    expect((await move(owner, workspace.id, id, 'DONE')).statusCode).toBe(200);
    const first = await completedAt(id);
    expect(first).toBeInstanceOf(Date);

    await request(`/workspaces/${workspace.id}/issues/${id}`, {
      method: 'PATCH',
      actor: owner,
      payload: { title: 'Renamed after it was done' },
    });
    expect(await completedAt(id)).toEqual(first);

    await move(owner, workspace.id, id, 'IN_PROGRESS');
    expect(await completedAt(id)).toBeNull();
    // Filed straight as done, it is done from the start.
    expect(
      await completedAt(await file(owner, workspace.id, project.id, { status: 'DONE' })),
    ).not.toBeNull();
  });
});

describe('the numbers and the state', () => {
  test('counts open, done, recent, overdue and urgent, and the state follows the rules', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const web = await createProject(owner, workspace.id, 'Web App');
    const docs = await createProject(owner, workspace.id, 'Docs Site');
    const quiet = await createProject(owner, workspace.id, 'Old Plans');
    const { ownerDb } = await getHarness();

    // Web: one urgent, one overdue, one done today, one done long ago.
    await file(owner, workspace.id, web.id, { priority: 'URGENT' });
    const late = await file(owner, workspace.id, web.id);
    await ownerDb.update(issues).set({ dueOn: '2001-01-01' }).where(eq(issues.id, late));
    await move(owner, workspace.id, await file(owner, workspace.id, web.id), 'DONE');
    const old = await file(owner, workspace.id, web.id, { status: 'DONE' });
    await ownerDb
      .update(issues)
      .set({ completedAt: daysAgo(30), createdAt: daysAgo(30) })
      .where(eq(issues.id, old));

    // Docs: one open, one done this week: on track.
    await file(owner, workspace.id, docs.id);
    await file(owner, workspace.id, docs.id, { status: 'DONE' });

    // Old plans: open, but untouched for three weeks.
    const still = await file(owner, workspace.id, quiet.id);
    await ownerDb
      .update(issues)
      .set({ updatedAt: daysAgo(21) })
      .where(eq(issues.id, still));

    const all = await healthOfAll(owner, workspace.id);
    expect(all.map((p) => [p.key, p.state])).toEqual([
      [web.key, 'needs_a_look'],
      [docs.key, 'on_track'],
      [quiet.key, 'quiet'],
    ]);
    expect(all[0]).toMatchObject({
      open: 2,
      done: 2,
      doneRecently: 1,
      openedRecently: 3,
      overdue: 1,
      urgent: 1,
    });
  });

  test('a project just finished shows as finished; one finished long ago, or empty, not at all', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const fresh = await createProject(owner, workspace.id, 'Launch');
    const stale = await createProject(owner, workspace.id, 'Last Year');
    await createProject(owner, workspace.id, 'Empty');
    const { ownerDb } = await getHarness();
    await file(owner, workspace.id, fresh.id, { status: 'DONE' });
    await file(owner, workspace.id, fresh.id, { status: 'CANCELED' });
    const long = await file(owner, workspace.id, stale.id, { status: 'DONE' });
    await ownerDb
      .update(issues)
      .set({ completedAt: daysAgo(60) })
      .where(eq(issues.id, long));

    expect((await healthOfAll(owner, workspace.id)).map((p) => [p.key, p.state])).toEqual([
      [fresh.key, 'finished'],
    ]);
  });
});

describe('the rules, on their own', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  const base = {
    open: 3,
    done: 1,
    overdue: 0,
    urgent: 0,
    lastMovedAt: now,
    lastDoneAt: null,
  };

  test('first rule that holds, in order', () => {
    expect(healthOf({ ...base, open: 0 }, now)).toBe('finished');
    expect(healthOf({ ...base, overdue: 1, lastMovedAt: new Date(0) }, now)).toBe('needs_a_look');
    expect(healthOf({ ...base, lastMovedAt: new Date(now.getTime() - 15 * DAY) }, now)).toBe(
      'quiet',
    );
    expect(healthOf({ ...base, lastMovedAt: new Date(now.getTime() - 13 * DAY) }, now)).toBe(
      'on_track',
    );
  });

  test('every issue cancelled is not finished, and not shown', () => {
    const cancelled = { ...base, open: 0, done: 0 };
    expect(healthOf(cancelled, now)).not.toBe('finished');
    expect(worthShowing(cancelled, now)).toBe(false);
  });

  test('overdue is judged on the viewer’s today, if it is within a day of the server’s', () => {
    expect(todayFor(undefined, now)).toBe('2026-11-20');
    expect(todayFor('2026-11-21', now)).toBe('2026-11-21');
    expect(todayFor('2026-11-19', now)).toBe('2026-11-19');
    expect(todayFor('2026-12-25', now)).toBe('2026-11-20');
  });
});

describe('who may see it', () => {
  test('a stranger gets 404', async () => {
    const owner = await createActor('Owner');
    const stranger = await createActor('Stranger');
    const workspace = await createWorkspace(owner);
    const reply = await request(`/workspaces/${workspace.id}/feed/projects`, { actor: stranger });
    expect(reply.statusCode).toBe(404);
  });
});
