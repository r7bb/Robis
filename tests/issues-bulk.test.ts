import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { auditEvents, issues } from '@robis/database';
import { and, eq, inArray } from 'drizzle-orm';
import {
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
 * Bulk actions (C1): one change to many issues. Each issue is judged on its
 * own, and one the caller may not change, cannot see, or that would not
 * change is skipped and reported; the rest change together, one audit event
 * each, under one idempotency key.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

async function setUp() {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const project = await createProject(owner, workspace.id);
  const base = `/workspaces/${workspace.id}`;
  const file = async (title: string) =>
    (
      await request(`${base}/projects/${project.id}/issues`, {
        method: 'POST',
        actor: owner,
        payload: { title },
      })
    ).json().issue;
  const bulk = (
    issueIds: string[],
    change: object,
    actor = owner,
    headers: Record<string, string> = {},
  ) =>
    request(`${base}/issues/bulk`, {
      method: 'POST',
      actor,
      payload: { issueIds, change },
      headers,
    });
  return { owner, workspace, project, base, file, bulk };
}

type Outcome = { changed: string[]; skipped: { id: string; reason: string }[] };

/** A bulk answer's body, typed. */
const outcomeOf = (res: { json: () => unknown }) => res.json() as Outcome;

async function eventsFor(workspaceId: string, type: string) {
  const { ownerDb } = await getHarness();
  return ownerDb
    .select({ entityId: auditEvents.entityId })
    .from(auditEvents)
    .where(and(eq(auditEvents.workspaceId, workspaceId), eq(auditEvents.eventType, type)));
}

describe('a bulk action', () => {
  test('changes every issue it may, with one audit event each', async () => {
    const { workspace, file, bulk } = await setUp();
    const a = await file('First');
    const b = await file('Second');
    const res = await bulk([a.id, b.id], { kind: 'status', status: 'DONE' });
    expect(res.statusCode).toBe(200);
    expect(outcomeOf(res)).toEqual({ changed: [a.id, b.id], skipped: [] });

    const { ownerDb } = await getHarness();
    const rows = await ownerDb
      .select({ status: issues.status })
      .from(issues)
      .where(inArray(issues.id, [a.id, b.id]));
    expect(rows.map((r) => r.status)).toEqual(['DONE', 'DONE']);
    const moved = await eventsFor(workspace.id, 'issue.status_changed');
    expect(moved.map((e) => e.entityId).sort()).toEqual([a.id, b.id].sort());
  });

  test('skips and reports the issues a guest may not change, changing none', async () => {
    const { owner, workspace, file, bulk } = await setUp();
    const a = await file('Theirs to read');
    const b = await file('Also theirs to read');
    const guest = await createActor('Guest');
    await addMember(owner, workspace.id, guest, 'GUEST');

    const res = await bulk([a.id, b.id], { kind: 'priority', priority: 'URGENT' }, guest);
    expect(res.statusCode).toBe(200);
    expect(outcomeOf(res)).toEqual({
      changed: [],
      skipped: [
        { id: a.id, reason: 'forbidden' },
        { id: b.id, reason: 'forbidden' },
      ],
    });
    expect(await eventsFor(workspace.id, 'issue.updated')).toEqual([]);
  });

  test('skips another workspace’s issue and a malformed id as not found, changing the rest', async () => {
    const { file, bulk } = await setUp();
    const mine = await file('Mine');
    const stranger = await createActor('Stranger');
    const elsewhere = await createWorkspace(stranger);
    const theirProject = await createProject(stranger, elsewhere.id);
    const theirs = (
      await request(`/workspaces/${elsewhere.id}/projects/${theirProject.id}/issues`, {
        method: 'POST',
        actor: stranger,
        payload: { title: 'Not yours' },
      })
    ).json().issue;

    const res = await bulk([mine.id, theirs.id, 'nope'], { kind: 'priority', priority: 'HIGH' });
    expect(outcomeOf(res)).toEqual({
      changed: [mine.id],
      skipped: [
        { id: theirs.id, reason: 'not_found' },
        { id: 'nope', reason: 'not_found' },
      ],
    });
    const { ownerDb } = await getHarness();
    const [untouched] = await ownerDb
      .select({ priority: issues.priority })
      .from(issues)
      .where(eq(issues.id, theirs.id));
    expect(untouched?.priority).not.toBe('HIGH');
  });

  test('reports an issue the change would leave as it is', async () => {
    const { file, bulk } = await setUp();
    const a = await file('Already done');
    const b = await file('Not yet');
    await bulk([a.id], { kind: 'status', status: 'DONE' });
    const res = await bulk([a.id, b.id], { kind: 'status', status: 'DONE' });
    expect(outcomeOf(res)).toEqual({
      changed: [b.id],
      skipped: [{ id: a.id, reason: 'unchanged' }],
    });
  });

  test('puts a label on and takes it off, and refuses another workspace’s label', async () => {
    const { owner, base, file, bulk } = await setUp();
    const a = await file('One');
    const b = await file('Two');
    const bug = (
      await request(`${base}/labels`, {
        method: 'POST',
        actor: owner,
        payload: { name: 'Bug', colour: 'rose' },
      })
    ).json().label;

    expect(
      (await bulk([a.id, b.id], { kind: 'addLabel', labelId: bug.id })).json().changed,
    ).toEqual([a.id, b.id]);
    const labelled = (await request(`${base}/issues/${a.id}`, { actor: owner })).json().issue;
    expect(labelled.labelIds).toEqual([bug.id]);

    const off = await bulk([a.id], { kind: 'removeLabel', labelId: bug.id });
    expect(off.json().changed).toEqual([a.id]);

    const stranger = await createActor('Stranger');
    const elsewhere = await createWorkspace(stranger);
    const theirs = (
      await request(`/workspaces/${elsewhere.id}/labels`, {
        method: 'POST',
        actor: stranger,
        payload: { name: 'Theirs', colour: 'sky' },
      })
    ).json().label;
    const refused = await bulk([a.id], { kind: 'addLabel', labelId: theirs.id });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toBe('bad_label');
  });

  test('deletes issues, audited each, and a replay with the same key does nothing twice', async () => {
    const { workspace, file, bulk } = await setUp();
    const a = await file('Going');
    const b = await file('Also going');
    const key = { 'idempotency-key': 'bulk-delete-1' };

    const first = await bulk([a.id, b.id], { kind: 'delete' }, undefined, key);
    expect(outcomeOf(first)).toEqual({ changed: [a.id, b.id], skipped: [] });
    const again = await bulk([a.id, b.id], { kind: 'delete' }, undefined, key);
    expect(outcomeOf(again)).toEqual(first.json());
    expect(again.headers['idempotent-replay']).toBe('true');

    const deleted = await eventsFor(workspace.id, 'issue.deleted');
    expect(deleted).toHaveLength(2);
  });

  test('refuses an empty list and more than a hundred ids', async () => {
    const { bulk } = await setUp();
    expect((await bulk([], { kind: 'delete' })).statusCode).toBe(400);
    const many = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    expect((await bulk(many, { kind: 'delete' })).statusCode).toBe(400);
  });
});

describe('a bulk action, at its edges', () => {
  test('assigns and unassigns, and refuses an agent as the assignee', async () => {
    const { owner, workspace, file, bulk } = await setUp();
    const a = await file('Needs an owner');
    const mate = await createActor('Mate');
    await addMember(owner, workspace.id, mate, 'MEMBER');

    expect(
      outcomeOf(await bulk([a.id], { kind: 'assignee', assigneeId: mate.id })).changed,
    ).toEqual([a.id]);
    expect(outcomeOf(await bulk([a.id], { kind: 'assignee', assigneeId: null })).changed).toEqual([
      a.id,
    ]);

    const bot = await createAgent(owner, workspace.id);
    const refused = await bulk([a.id], { kind: 'assignee', assigneeId: bot.id });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toBe('assignee_not_person');
  });

  test('counts an issue named twice, in either case, once', async () => {
    const { file, bulk } = await setUp();
    const a = await file('Named twice');
    const res = await bulk([a.id, a.id.toUpperCase()], { kind: 'priority', priority: 'LOW' });
    expect(outcomeOf(res)).toEqual({ changed: [a.id], skipped: [] });
  });

  test('leaves an issue already at the label limit alone', async () => {
    const { owner, base, file, bulk } = await setUp();
    const full = await file('Covered in labels');
    const make = async (name: string) =>
      (
        await request(`${base}/labels`, {
          method: 'POST',
          actor: owner,
          payload: { name, colour: 'sky' },
        })
      ).json().label.id as string;
    const twenty = [];
    for (let i = 0; i < 20; i++) twenty.push(await make(`L${i}`));
    await request(`${base}/issues/${full.id}/labels`, {
      method: 'PUT',
      actor: owner,
      payload: { labelIds: twenty },
    });
    const one = await make('One more');
    const res = await bulk([full.id], { kind: 'addLabel', labelId: one });
    expect(outcomeOf(res)).toEqual({
      changed: [],
      skipped: [{ id: full.id, reason: 'too_many_labels' }],
    });
  });

  test('tells a guest nothing about a label it names, only that it may not', async () => {
    const { owner, workspace, file, bulk } = await setUp();
    const a = await file('Read only');
    const guest = await createActor('Guest');
    await addMember(owner, workspace.id, guest, 'GUEST');
    const nowhere = '00000000-0000-4000-8000-000000000000';
    const res = await bulk([a.id], { kind: 'addLabel', labelId: nowhere }, guest);
    expect(res.statusCode).toBe(200);
    expect(outcomeOf(res).skipped).toEqual([{ id: a.id, reason: 'forbidden' }]);
  });

  test('an agent changes up to 25 at once, records itself as delegate, and never deletes in bulk', async () => {
    const { owner, workspace, base, file } = await setUp();
    const a = await file('For the agent');
    const bot = await createAgent(owner, workspace.id);
    const asBot = (issueIds: string[], change: object) =>
      request(`${base}/issues/bulk`, {
        method: 'POST',
        payload: { issueIds, change },
        headers: { authorization: `Bearer ${bot.secret}` },
      });

    expect(outcomeOf(await asBot([a.id], { kind: 'priority', priority: 'HIGH' })).changed).toEqual([
      a.id,
    ]);
    const { ownerDb } = await getHarness();
    const [row] = await ownerDb
      .select({ delegateId: issues.delegateId })
      .from(issues)
      .where(eq(issues.id, a.id));
    expect(row?.delegateId).toBe(bot.id);

    const removed = await asBot([a.id], { kind: 'delete' });
    expect(removed.statusCode).toBe(403);
    expect(removed.json().error).toBe('agent_bulk_delete');
    const many = Array.from({ length: 26 }, (_, i) => `id-${i}`);
    const tooMany = await asBot(many, { kind: 'priority', priority: 'LOW' });
    expect(tooMany.json().error).toBe('agent_bulk_limit');
  });
});

/** An agent in the workspace, with its token, made the way an admin makes one. */
async function createAgent(admin: { cookie: string }, workspaceId: string) {
  const response = await request(`/workspaces/${workspaceId}/agents`, {
    method: 'POST',
    actor: admin as never,
    payload: { name: 'Bulk bot', role: 'MEMBER' },
  });
  if (response.statusCode !== 201)
    throw new Error(`agent: ${response.statusCode} ${response.body}`);
  const { agent, token } = response.json();
  return { id: agent.id as string, secret: token.secret as string };
}
