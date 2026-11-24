import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { keysIn } from '@robis/api/github-pull-requests';
import { auditEvents } from '@robis/database';
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
 * GitHub pull requests on issues (C7). Done when: a signed pull request
 * whose title or branch names an issue key shows on that issue with its
 * state; a merge moves the issue to done only when the workspace chose it;
 * an unsigned or wrongly signed delivery changes nothing; and only admins
 * connect.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

async function setUp() {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const project = await createProject(owner, workspace.id, 'Web App');
  const file = async (title: string) =>
    (
      await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
        method: 'POST',
        actor: owner,
        payload: { title },
      })
    ).json().issue as { id: string; key: string; number: number };
  return { owner, workspace, project, file };
}

async function connect(actor: Actor, workspaceId: string, moveToDone: boolean) {
  return request(`/workspaces/${workspaceId}/github`, {
    method: 'POST',
    actor,
    payload: { moveToDone },
  });
}

let tick = 0;

function pullRequest(fields: {
  number: number;
  title: string;
  branch: string;
  state?: 'open' | 'closed';
  merged?: boolean;
  /** When GitHub says it last changed; later each time unless given. */
  at?: string;
}) {
  return JSON.stringify({
    action: fields.merged ? 'closed' : 'opened',
    pull_request: {
      number: fields.number,
      title: fields.title,
      html_url: `https://github.com/acme/web/pull/${fields.number}`,
      state: fields.state ?? 'open',
      merged: fields.merged ?? false,
      draft: false,
      updated_at: fields.at ?? new Date(Date.now() + tick++ * 1000).toISOString(),
      head: { ref: fields.branch },
    },
    repository: { full_name: 'acme/web' },
  });
}

async function deliver(workspaceId: string, secret: string, body: string, event = 'pull_request') {
  return request(`/github/webhook/${workspaceId}`, {
    method: 'POST',
    payload: body,
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    },
  });
}

const prsOf = async (actor: Actor, workspaceId: string, issueId: string) =>
  (await request(`/workspaces/${workspaceId}/issues/${issueId}/pull-requests`, { actor })).json()
    .pullRequests as { number: number; state: string }[];

describe('a pull request from GitHub', () => {
  test('reads issue keys from a title and a branch, either case, once each', () => {
    expect(keysIn('WA-12: fix the menu', 'wa-13-and-WA-12')).toEqual([
      { key: 'WA', number: 12 },
      { key: 'WA', number: 13 },
    ]);
    expect(keysIn('no keys here', 'main')).toEqual([]);
  });

  test('links to the issues it names, by title and by branch, with its state', async () => {
    const { owner, workspace, file } = await setUp();
    const first = await file('Menu overlaps');
    const second = await file('Footer gap');
    const { secret } = (await connect(owner, workspace.id, false)).json();
    expect((await deliver(workspace.id, secret, '{}', 'ping')).statusCode).toBe(204);

    const opened = await deliver(
      workspace.id,
      secret,
      pullRequest({
        number: 7,
        title: `${first.key}: fix the menu`,
        branch: `fix/${second.key.toLowerCase()}-footer`,
      }),
    );
    expect(opened.statusCode).toBe(202);
    expect(opened.json() as unknown).toEqual({ linked: 2, moved: 0 });
    expect(await prsOf(owner, workspace.id, first.id)).toMatchObject([
      { number: 7, state: 'open' },
    ]);
    expect(await prsOf(owner, workspace.id, second.id)).toMatchObject([
      { number: 7, state: 'open' },
    ]);

    // Merged, with moving to done left off: the state changes, the issue does not.
    await deliver(
      workspace.id,
      secret,
      pullRequest({
        number: 7,
        title: `${first.key}: fix the menu`,
        branch: 'x',
        state: 'closed',
        merged: true,
      }),
    );
    expect(await prsOf(owner, workspace.id, first.id)).toMatchObject([{ state: 'merged' }]);
    const still = await request(`/workspaces/${workspace.id}/issues/${first.id}`, { actor: owner });
    expect(still.json().issue.status).toBe('TODO');
  });

  test('a merge moves the issue to done when the workspace chose it, as Robis', async () => {
    const { owner, workspace, file } = await setUp();
    const issue = await file('Ship it');
    const { secret } = (await connect(owner, workspace.id, true)).json();
    const merged = await deliver(
      workspace.id,
      secret,
      pullRequest({
        number: 9,
        title: `Ship ${issue.key}`,
        branch: 'main',
        state: 'closed',
        merged: true,
      }),
    );
    expect(merged.json() as unknown).toEqual({ linked: 1, moved: 1 });
    const done = await request(`/workspaces/${workspace.id}/issues/${issue.id}`, { actor: owner });
    expect(done.json().issue.status).toBe('DONE');
    const { ownerDb } = await getHarness();
    const [moved] = await ownerDb
      .select({ actorKind: auditEvents.actorKind })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.entityId, issue.id), eq(auditEvents.eventType, 'issue.status_changed')),
      );
    expect(moved!.actorKind).toBe('system');
  });

  test('a replayed or late delivery changes nothing, and a merge closes an issue only once', async () => {
    const { owner, workspace, file } = await setUp();
    const issue = await file('Reopened later');
    const { secret } = (await connect(owner, workspace.id, true)).json();
    const merge = pullRequest({
      number: 4,
      title: issue.key,
      branch: 'x',
      state: 'closed',
      merged: true,
      at: '2026-11-24T10:00:00Z',
    });
    await deliver(workspace.id, secret, merge);
    // Someone reopens the issue; the merge is delivered again.
    await request(`/workspaces/${workspace.id}/issues/${issue.id}`, {
      method: 'PATCH',
      actor: owner,
      payload: { status: 'IN_PROGRESS' },
    });
    expect((await deliver(workspace.id, secret, merge)).json() as unknown).toEqual({
      linked: 0,
      moved: 0,
    });
    const late = pullRequest({
      number: 4,
      title: issue.key,
      branch: 'x',
      at: '2026-11-24T09:00:00Z',
    });
    await deliver(workspace.id, secret, late);
    expect(await prsOf(owner, workspace.id, issue.id)).toMatchObject([{ state: 'merged' }]);
    const after = await request(`/workspaces/${workspace.id}/issues/${issue.id}`, { actor: owner });
    expect(after.json().issue.status).toBe('IN_PROGRESS');
  });

  test('a link that is not https is refused', async () => {
    const { owner, workspace, file } = await setUp();
    const issue = await file('Clickable');
    const { secret } = (await connect(owner, workspace.id, false)).json();
    const evil = pullRequest({ number: 5, title: issue.key, branch: 'x' }).replace(
      'https://github.com/acme/web/pull/5',
      'javascript:alert(1)',
    );
    expect((await deliver(workspace.id, secret, evil)).statusCode).toBe(400);
    expect(await prsOf(owner, workspace.id, issue.id)).toEqual([]);
  });

  test('an unsigned or wrongly signed delivery, or one to a workspace not connected, changes nothing', async () => {
    const { owner, workspace, file } = await setUp();
    const issue = await file('Guarded');
    const body = pullRequest({ number: 3, title: `${issue.key} forged`, branch: 'x' });
    expect((await deliver(workspace.id, 'not-the-secret', body)).statusCode).toBe(401);
    await connect(owner, workspace.id, true);
    expect((await deliver(workspace.id, 'not-the-secret', body)).statusCode).toBe(401);
    const unsigned = await request(`/github/webhook/${workspace.id}`, {
      method: 'POST',
      payload: body,
      headers: { 'content-type': 'application/json', 'x-github-event': 'pull_request' },
    });
    expect(unsigned.statusCode).toBe(401);
    expect(await prsOf(owner, workspace.id, issue.id)).toEqual([]);
  });

  test('another workspace with the same project key is untouched; only admins connect', async () => {
    const { owner, workspace, file } = await setUp();
    const mine = await file('Mine');
    const other = await setUp();
    const theirs = await other.file('Theirs');
    expect(theirs.key).toBe(mine.key);
    const { secret } = (await connect(owner, workspace.id, true)).json();
    await deliver(
      workspace.id,
      secret,
      pullRequest({ number: 1, title: mine.key, branch: 'x', state: 'closed', merged: true }),
    );
    const untouched = await request(`/workspaces/${other.workspace.id}/issues/${theirs.id}`, {
      actor: other.owner,
    });
    expect(untouched.json().issue.status).toBe('TODO');

    const member = await createActor('Member');
    await addMember(owner, workspace.id, member, 'MEMBER');
    expect((await connect(member, workspace.id, false)).statusCode).toBe(403);
  });
});
