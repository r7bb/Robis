import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { releaseNotes } from '@robis/shared';
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
 * Releases: a version of the work, gathered from any of the workspace's
 * boards, with a day it is aimed at. Shipping one stamps it and writes its
 * notes from what was done; work still open stays listed as open. Removing
 * one leaves its issues where they were, in no release.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

async function setUp() {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const web = await createProject(owner, workspace.id, 'Web');
  const app = await createProject(owner, workspace.id, 'App');
  const ws = `/workspaces/${workspace.id}`;
  const make = (actor: Actor, body: Record<string, unknown>) =>
    request(`${ws}/releases`, { method: 'POST', actor, payload: body });
  const file = async (projectId: string, title: string, status = 'TODO') =>
    (
      await request(`${ws}/projects/${projectId}/issues`, {
        method: 'POST',
        actor: owner,
        payload: { title, status },
      })
    ).json().issue as { id: string };
  const put = (issueId: string, releaseId: string | null, actor = owner) =>
    request(`${ws}/issues/${issueId}`, { method: 'PATCH', actor, payload: { releaseId } });
  return { owner, workspace, web, app, ws, make, file, put };
}

describe('releases', () => {
  test('made, given issues from more than one board, counted and listed', async () => {
    const { owner, web, app, ws, make, file, put } = await setUp();
    const made = await make(owner, { name: 'Version 2.0', targetOn: '2026-12-15' });
    expect(made.statusCode).toBe(201);
    const release = made.json().release;
    for (const issue of [
      await file(web.id, 'New pricing page', 'DONE'),
      await file(app.id, 'Offline sign-in'),
      await file(app.id, 'Old flow', 'CANCELED'),
    ]) {
      expect((await put(issue.id, release.id)).statusCode).toBe(200);
    }
    const listed = (await request(`${ws}/releases`, { actor: owner })).json();
    expect(listed.releases).toEqual([
      expect.objectContaining({
        id: release.id,
        name: 'Version 2.0',
        targetOn: '2026-12-15',
        shippedAt: null,
        total: 3,
        done: 1,
        canceled: 1,
      }),
    ]);
    const one = (await request(`${ws}/releases/${release.id}`, { actor: owner })).json();
    expect(
      one.issues.map((i: { title: string; projectName: string }) => [i.projectName, i.title]),
    ).toEqual([
      ['App', 'Offline sign-in'],
      ['App', 'Old flow'],
      ['Web', 'New pricing page'],
    ]);
  });

  test('shipping stamps it and writes notes from what was done; it then takes no more', async () => {
    const { owner, web, app, ws, make, file, put } = await setUp();
    const release = (await make(owner, { name: 'Version 2.0' })).json().release;
    const done = await file(web.id, 'New pricing page', 'DONE');
    const open = await file(app.id, 'Offline sign-in');
    for (const issue of [done, open]) await put(issue.id, release.id);

    const shipped = await request(`${ws}/releases/${release.id}/ship`, {
      method: 'POST',
      actor: owner,
      payload: {},
    });
    expect(shipped.statusCode).toBe(200);
    const after = shipped.json().release;
    expect(after.shippedAt).not.toBeNull();
    expect(after.notes).toContain('New pricing page');
    expect(after.notes).not.toContain('Offline sign-in');

    const late = await file(web.id, 'Too late');
    const refused = await put(late.id, release.id);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toBe('release_shipped');
    const again = await request(`${ws}/releases/${release.id}/ship`, {
      method: 'POST',
      actor: owner,
      payload: {},
    });
    expect(again.json().error).toBe('release_shipped');

    // What shipped stays in it: not taken out, nor moved to another release.
    const next = (await make(owner, { name: 'Version 2.1' })).json().release;
    const out = await put(open.id, null);
    expect(out.statusCode).toBe(400);
    expect(out.json().error).toBe('release_shipped');
    expect((await put(open.id, next.id)).json().error).toBe('release_shipped');
    // Its other fields still change.
    const renamed = await request(`${ws}/issues/${open.id}`, {
      method: 'PATCH',
      actor: owner,
      payload: { title: 'Offline sign-in, part two' },
    });
    expect(renamed.statusCode).toBe(200);
  });

  test('two ships at once ship it once, with one set of notes', async () => {
    const { owner, web, ws, make, file, put } = await setUp();
    const release = (await make(owner, { name: 'Version 2.0' })).json().release;
    await put((await file(web.id, 'Done', 'DONE')).id, release.id);
    const ship = () =>
      request(`${ws}/releases/${release.id}/ship`, { method: 'POST', actor: owner, payload: {} });
    const answers = await Promise.all([ship(), ship()]);
    expect(answers.map((a) => a.statusCode).sort()).toEqual([200, 400]);
  });

  test('removing one leaves its issues in no release; a guest neither plans nor ships', async () => {
    const { owner, workspace, web, ws, make, file, put } = await setUp();
    const release = (await make(owner, { name: 'Version 2.0' })).json().release;
    const issue = await file(web.id, 'Pricing');
    await put(issue.id, release.id);
    const guest = await createActor('Guest');
    await addMember(owner, workspace.id, guest, 'GUEST');
    expect((await make(guest, { name: 'Nope' })).statusCode).toBe(403);
    expect(
      (
        await request(`${ws}/releases/${release.id}/ship`, {
          method: 'POST',
          actor: guest,
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect((await request(`${ws}/releases`, { actor: guest })).statusCode).toBe(200);

    expect(
      (await request(`${ws}/releases/${release.id}`, { method: 'DELETE', actor: owner }))
        .statusCode,
    ).toBe(204);
    const read = (await request(`${ws}/issues/${issue.id}`, { actor: owner })).json().issue;
    expect(read.releaseId).toBeNull();
  });

  test('another workspace’s release is not found, and cannot be given an issue', async () => {
    const { owner, web, file, put } = await setUp();
    const stranger = await createActor('Stranger');
    const theirs = await createWorkspace(stranger);
    const theirRelease = (
      await request(`/workspaces/${theirs.id}/releases`, {
        method: 'POST',
        actor: stranger,
        payload: { name: 'Theirs' },
      })
    ).json().release;
    const issue = await file(web.id, 'Mine');
    const refused = await put(issue.id, theirRelease.id);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toBe('bad_release');
    const seen = await request(`/workspaces/${theirs.id}/releases/${theirRelease.id}`, {
      actor: owner,
    });
    expect(seen.statusCode).toBe(404);
  });
});

describe('a board narrowed to a release', () => {
  test('lists only that board’s issues in the release, each saying its release', async () => {
    const { owner, web, app, ws, make, file, put } = await setUp();
    const release = (await make(owner, { name: 'Version 2.0' })).json().release;
    const inIt = await file(web.id, 'In it');
    await file(web.id, 'Not in it');
    await put(inIt.id, release.id);
    await put((await file(app.id, 'Other board')).id, release.id);
    const listed = (
      await request(`${ws}/projects/${web.id}/issues?releaseId=${release.id}`, { actor: owner })
    ).json().issues as { id: string; releaseId: string | null }[];
    expect(listed).toEqual([expect.objectContaining({ id: inIt.id, releaseId: release.id })]);
  });
});

describe('release notes', () => {
  test('what was done, by board, with the day it shipped', () => {
    const notes = releaseNotes({
      name: 'Version 2.0',
      shippedOn: '2026-12-15',
      issues: [
        { key: 'WEB-3', title: 'New pricing page', projectName: 'Web', status: 'DONE' },
        { key: 'APP-9', title: 'Offline sign-in', projectName: 'App', status: 'DONE' },
        { key: 'APP-2', title: 'Faster start', projectName: 'App', status: 'DONE' },
        { key: 'APP-4', title: 'Still going', projectName: 'App', status: 'IN_PROGRESS' },
        { key: 'WEB-1', title: 'Dropped', projectName: 'Web', status: 'CANCELED' },
      ],
    });
    expect(notes).toBe(
      [
        'Version 2.0, shipped 2026-12-15',
        '',
        'App',
        '- APP-2 Faster start',
        '- APP-9 Offline sign-in',
        '',
        'Web',
        '- WEB-3 New pricing page',
      ].join('\n'),
    );
    expect(releaseNotes({ name: 'Empty', shippedOn: '2026-12-15', issues: [] })).toBe(
      'Empty, shipped 2026-12-15\n\nNothing was done in this release.',
    );
  });
});

describe('changing a release', () => {
  test('its name and day, until it ships; a guest cannot', async () => {
    const { owner, workspace, ws, make } = await setUp();
    const release = (await make(owner, { name: 'Version 2.0', targetOn: '2026-12-15' })).json()
      .release;
    const change = (actor: Actor, body: Record<string, unknown>) =>
      request(`${ws}/releases/${release.id}`, { method: 'PATCH', actor, payload: body });

    const moved = await change(owner, { name: 'Version 2.1', targetOn: '2026-12-22' });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().release).toMatchObject({ name: 'Version 2.1', targetOn: '2026-12-22' });
    const cleared = await change(owner, { targetOn: null });
    expect(cleared.json().release.targetOn).toBeNull();

    const guest = await createActor('Guest');
    await addMember(owner, workspace.id, guest, 'GUEST');
    expect((await change(guest, { name: 'Nope' })).statusCode).toBe(403);

    await request(`${ws}/releases/${release.id}/ship`, {
      method: 'POST',
      actor: owner,
      payload: {},
    });
    const late = await change(owner, { name: 'Too late' });
    expect(late.statusCode).toBe(400);
    expect(late.json().error).toBe('release_shipped');
  });
});
