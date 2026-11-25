import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { notificationLine } from '@robis/mailer';
import { notificationHref } from '@robis/web/lib/notification-text.ts';
import { runReleaseDueScan } from '@robis/worker/release-due';
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
 * A release due tomorrow (C3 notices): from nine in the morning where it was
 * planned, each person with an issue still open in it hears once for that
 * day, with how many of theirs; a shipped release, or one with no day, tells
 * nobody, and a release moved later is told again.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

type Item = {
  kind: string;
  workspaceId: string | null;
  actorName: string | null;
  payload: { releaseId?: string; title?: string; body?: string };
};

const inbox = async (actor: Actor) =>
  ((await request('/notifications', { actor })).json().notifications as Item[]).filter(
    (item) => item.kind === 'release_due',
  );

async function team() {
  const ana = await createActor('Ana');
  const bo = await createActor('Bo');
  const workspace = await createWorkspace(ana);
  await addMember(ana, workspace.id, bo, 'MEMBER');
  const ws = `/workspaces/${workspace.id}`;
  const web = await createProject(ana, workspace.id, 'Web');
  const app = await createProject(ana, workspace.id, 'App');
  const plan = async (body: Record<string, unknown>) =>
    (
      await request(`${ws}/releases`, {
        method: 'POST',
        actor: ana,
        payload: { name: 'Version 2.0', ...body },
      })
    ).json().release as { id: string };
  const file = async (projectId: string, releaseId: string, assignee: Actor, status = 'TODO') => {
    const { issue } = (
      await request(`${ws}/projects/${projectId}/issues`, {
        method: 'POST',
        actor: ana,
        payload: { title: 'Work', status, assigneeId: assignee.id },
      })
    ).json();
    await request(`${ws}/issues/${issue.id}`, {
      method: 'PATCH',
      actor: ana,
      payload: { releaseId },
    });
    return issue as { id: string };
  };
  return { ana, bo, workspace, ws, web, app, plan, file };
}

const scan = async (now: Date) => runReleaseDueScan((await getHarness()).workerDb, now);
const TEN_UTC = new Date('2026-11-24T10:00:00Z');

describe('telling people a release is due tomorrow', () => {
  test('each person with work open in it, across boards, hears once', async () => {
    const { ana, bo, workspace, web, app, plan, file } = await team();
    const release = await plan({ targetOn: '2026-11-25', timeZone: 'UTC' });
    await file(web.id, release.id, ana);
    await file(app.id, release.id, ana);
    await file(app.id, release.id, bo, 'DONE');

    await scan(TEN_UTC);
    await scan(new Date('2026-11-24T11:00:00Z'));

    const [item, ...more] = await inbox(ana);
    expect(more).toEqual([]);
    expect(item).toMatchObject({
      payload: {
        releaseId: release.id,
        title: 'Version 2.0',
        body: '2 of your issues are still open in it.',
      },
    });
    expect(await inbox(bo)).toEqual([]);
    expect(notificationHref(item!)).toBe(`/workspaces/${workspace.id}/releases`);
    expect(
      notificationLine({ kind: 'release_due', actor: null, link: 'x', ...item!.payload }),
    ).toBe('Version 2.0 is due tomorrow: 2 of your issues are still open in it.');
  });

  test('not before nine where it was planned; a shipped one or one with no day tells nobody', async () => {
    const { ana, ws, web, plan, file } = await team();
    const london = await plan({ targetOn: '2026-11-25', timeZone: 'Europe/London' });
    await file(web.id, london.id, ana);
    await scan(new Date('2026-11-24T01:00:00Z'));
    expect(await inbox(ana)).toEqual([]);

    const undated = await plan({ name: 'Someday' });
    await file(web.id, undated.id, ana);
    await request(`${ws}/releases/${london.id}/ship`, { method: 'POST', actor: ana, payload: {} });
    await scan(TEN_UTC);
    expect(await inbox(ana)).toEqual([]);
  });

  test('in Tokyo the morning comes first; a release moved later is told again', async () => {
    const { ana, ws, web, plan, file } = await team();
    const tokyo = await plan({ targetOn: '2026-11-25', timeZone: 'Asia/Tokyo' });
    await file(web.id, tokyo.id, ana);
    await scan(new Date('2026-11-24T01:00:00Z'));
    expect(await inbox(ana)).toHaveLength(1);

    await request(`${ws}/releases/${tokyo.id}`, {
      method: 'PATCH',
      actor: ana,
      payload: { targetOn: '2026-11-27' },
    });
    await scan(new Date('2026-11-26T01:00:00Z'));
    expect(await inbox(ana)).toHaveLength(2);
  });
});
