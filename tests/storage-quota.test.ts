import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { attachments, WORKSPACE_STORAGE_QUOTA_BYTES } from '@robis/database';
import sharp from 'sharp';
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
 * A storage quota per workspace (stage 1, item 11): checked before an
 * upload is read, so a full workspace refuses a file without processing
 * it; and how much is used, shown to its owners only.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

async function workspaceWithIssue() {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const project = await createProject(owner, workspace.id);
  const issue = await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
    method: 'POST',
    actor: owner,
    payload: { title: 'Pictures' },
  });
  return { owner, workspace, issueId: issue.json().issue.id as string };
}

async function upload(cookie: string, workspaceId: string, issueId: string) {
  const { app } = await getHarness();
  const body = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } })
    .png()
    .toBuffer();
  return app.inject({
    method: 'POST',
    url: `/workspaces/${workspaceId}/issues/${issueId}/attachments`,
    headers: { cookie, 'content-type': 'image/png' },
    payload: body,
  });
}

/** Fill the workspace to within a few bytes of its quota. */
async function fill(workspaceId: string, issueId: string) {
  const { db } = await getHarness();
  await db.insert(attachments).values({
    workspaceId,
    issueId,
    storageKey: `test/${workspaceId}/big.png`,
    contentType: 'image/png',
    bytes: WORKSPACE_STORAGE_QUOTA_BYTES - 10,
    width: 1,
    height: 1,
  });
}

describe('the storage quota', () => {
  test('lets an upload in while there is room', async () => {
    const { owner, workspace, issueId } = await workspaceWithIssue();
    expect((await upload(owner.cookie, workspace.id, issueId)).statusCode).toBe(201);
  });

  test('refuses an upload that would pass it, before reading it', async () => {
    const { owner, workspace, issueId } = await workspaceWithIssue();
    await fill(workspace.id, issueId);
    const response = await upload(owner.cookie, workspace.id, issueId);
    expect(response.statusCode).toBe(413);
    expect(response.json().error).toBe('storage_quota_exceeded');
  });

  test('is shown to owners, and to nobody else', async () => {
    const { owner, workspace, issueId } = await workspaceWithIssue();
    const member = await createActor('Member');
    await addMember(owner, workspace.id, member, 'MEMBER');
    await fill(workspace.id, issueId);

    const mine = (await request('/workspaces/overview', { actor: owner })).json();
    expect(mine.workspaces[0].storage).toEqual({
      used: WORKSPACE_STORAGE_QUOTA_BYTES - 10,
      quota: WORKSPACE_STORAGE_QUOTA_BYTES,
    });
    const theirs = (await request('/workspaces/overview', { actor: member })).json();
    expect(theirs.workspaces[0].storage).toBeNull();
  });
});
