import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { runApiJobs } from '@robis/api/automation-runner';
import { runExportJob } from '@robis/api/export-job';
import { loggableUrl } from '@robis/api/tracing';
import {
  auditEvents,
  jobs,
  notifications,
  STORAGE_PURGE_JOB,
  WORKSPACE_EXPORT_JOB,
  workspaceExports,
} from '@robis/database';
import { localDiskStorage, readZip } from '@robis/storage';
import { and, eq } from 'drizzle-orm';
import {
  ACTOR_PASSWORD,
  addMember,
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  getHarness,
  MEDIA_ROOT,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * Workspace exports (C6). Done when: an admin asks, a job builds a zip of
 * everything the workspace owns, and the admin downloads it once through a
 * link that works once and expires; a member cannot; the file holds the
 * rows and no email address or webhook secret; and each step is audited.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const quiet = { error() {} };

async function runJobs() {
  const { db } = await getHarness();
  const storage = localDiskStorage(MEDIA_ROOT);
  await runApiJobs(db, 'test-runner', quiet, {
    [WORKSPACE_EXPORT_JOB]: (payload) => runExportJob(db, storage, payload),
  });
}

async function setUp() {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const project = await createProject(owner, workspace.id);
  const issue = (
    await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      method: 'POST',
      actor: owner,
      payload: { title: 'Ship the export' },
    })
  ).json().issue as { id: string };
  await request(`/workspaces/${workspace.id}/issues/${issue.id}/comments`, {
    method: 'POST',
    actor: owner,
    payload: { body: 'Zip it up' },
  });
  const rule = await request(`/workspaces/${workspace.id}/automations`, {
    method: 'POST',
    actor: owner,
    payload: {
      name: 'Hook',
      trigger: 'issue.created',
      conditions: [],
      action: { kind: 'webhook', url: 'https://hooks.example.com/robis' },
    },
  });
  const secret = rule.json().rule.action.secret as string;
  return { owner, workspace, project, issue, secret };
}

const base = (workspaceId: string) => `/workspaces/${workspaceId}/exports`;

describe('a workspace export', () => {
  test('is built by a job and downloaded once, holding the rows and no secrets', async () => {
    const { owner, workspace, secret } = await setUp();
    const asked = await request(base(workspace.id), { method: 'POST', actor: owner });
    expect(asked.statusCode).toBe(202);
    const exportId = asked.json().export.id as string;
    expect(asked.json().export.status).toBe('pending');
    const again = await request(base(workspace.id), { method: 'POST', actor: owner });
    expect(again.statusCode).toBe(409);

    await runJobs();
    const listed = (await request(base(workspace.id), { actor: owner })).json().exports;
    expect(listed[0]).toMatchObject({ id: exportId, status: 'ready' });
    expect(listed[0].bytes).toBeGreaterThan(0);

    const { ownerDb } = await getHarness();
    const told = await ownerDb
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, owner.id), eq(notifications.kind, 'export')));
    expect(told).toHaveLength(1);

    const link = await request(`${base(workspace.id)}/${exportId}/link`, {
      method: 'POST',
      actor: owner,
    });
    expect(link.statusCode).toBe(200);
    const path = (link.json().url as string).replace(/^\/api/, '');
    const got = await request(path, { actor: owner });
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-type']).toBe('application/zip');
    expect(String(got.headers['content-disposition'])).toContain('attachment;');
    expect(got.headers['cache-control']).toBe('no-store');

    const entries = readZip(new Uint8Array(got.rawPayload), 10_000_000);
    const named = new Map(entries.map((e) => [e.name, new TextDecoder().decode(e.data)]));
    const manifest = JSON.parse(named.get('manifest.json')!);
    expect(manifest).toMatchObject({ format: 'robis-export', version: 1 });
    expect(manifest.counts['issues.jsonl']).toBe(1);
    expect(named.get('issues.jsonl')).toContain('Ship the export');
    expect(named.get('comments.jsonl')).toContain('Zip it up');
    expect(named.get('members.jsonl')).toContain(owner.username);
    const everything = [...named.values()].join('\n');
    expect(everything).not.toContain(owner.email);
    expect(everything).not.toContain(secret);
    expect(everything).not.toContain('search_vector');
    // A webhook keeps only its origin: for many services the address is the key.
    expect(named.get('automation-rules.jsonl')).toContain('https://hooks.example.com/…');
    expect(everything).not.toContain('hooks.example.com/robis');

    // Once only, and the file is queued to be purged.
    expect((await request(path, { actor: owner })).statusCode).toBe(404);
    const relink = await request(`${base(workspace.id)}/${exportId}/link`, {
      method: 'POST',
      actor: owner,
    });
    expect(relink.statusCode).toBe(404);
    // One purge for when the keeping window ends, one for after the download.
    expect(await ownerDb.select().from(jobs).where(eq(jobs.kind, STORAGE_PURGE_JOB))).toHaveLength(
      2,
    );
    const trail = await ownerDb
      .select({ eventType: auditEvents.eventType })
      .from(auditEvents)
      .where(eq(auditEvents.entityId, exportId));
    expect(trail.map((e) => e.eventType).sort()).toEqual([
      'workspace.export_downloaded',
      'workspace.export_link',
      'workspace.export_ready',
      'workspace.export_requested',
    ]);
  });

  test('an expired link or a wrong token gets nothing; a member cannot export', async () => {
    const { owner, workspace } = await setUp();
    const exportId = (await request(base(workspace.id), { method: 'POST', actor: owner })).json()
      .export.id as string;
    await runJobs();
    const url = (
      await request(`${base(workspace.id)}/${exportId}/link`, { method: 'POST', actor: owner })
    ).json().url as string;
    const path = url.replace(/^\/api/, '');

    const wrong = path.replace(/[^/]+$/, 'not-the-token');
    expect((await request(wrong, { actor: owner })).statusCode).toBe(404);

    const { ownerDb } = await getHarness();
    await ownerDb
      .update(workspaceExports)
      .set({ linkExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(workspaceExports.id, exportId));
    expect((await request(path, { actor: owner })).statusCode).toBe(404);

    const member = await createActor('Member');
    await addMember(owner, workspace.id, member, 'MEMBER');
    expect((await request(base(workspace.id), { method: 'POST', actor: member })).statusCode).toBe(
      403,
    );
    // Nor download with the owner's link.
    await ownerDb
      .update(workspaceExports)
      .set({ linkExpiresAt: new Date(Date.now() + 60_000) })
      .where(eq(workspaceExports.id, exportId));
    expect((await request(path, { actor: member })).statusCode).toBe(403);
  });

  test('a HEAD or a missing file never spends the link', async () => {
    const { owner, workspace } = await setUp();
    const exportId = (await request(base(workspace.id), { method: 'POST', actor: owner })).json()
      .export.id as string;
    await runJobs();
    const url = (
      await request(`${base(workspace.id)}/${exportId}/link`, { method: 'POST', actor: owner })
    ).json().url as string;
    const path = url.replace(/^\/api/, '');
    const { app } = await getHarness();
    const head = await app.inject({ method: 'HEAD', url: path, headers: { cookie: owner.cookie } });
    expect(head.statusCode).toBe(404);

    const { ownerDb } = await getHarness();
    const [row] = await ownerDb
      .select()
      .from(workspaceExports)
      .where(eq(workspaceExports.id, exportId));
    await localDiskStorage(MEDIA_ROOT).delete(row!.storageKey!);
    expect((await request(path, { actor: owner })).statusCode).toBe(404);
    const [after] = await ownerDb
      .select()
      .from(workspaceExports)
      .where(eq(workspaceExports.id, exportId));
    expect(after).toMatchObject({ status: 'ready' });
    expect(after!.linkHash).not.toBeNull();
  });

  test('an old export shows expired, a dead build shows failed and blocks nothing', async () => {
    const { owner, workspace } = await setUp();
    const exportId = (await request(base(workspace.id), { method: 'POST', actor: owner })).json()
      .export.id as string;
    await runJobs();
    const { ownerDb } = await getHarness();
    await ownerDb
      .update(workspaceExports)
      .set({ readyAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) })
      .where(eq(workspaceExports.id, exportId));
    const listed = (await request(base(workspace.id), { actor: owner })).json().exports;
    expect(listed[0].status).toBe('expired');
    const link = await request(`${base(workspace.id)}/${exportId}/link`, {
      method: 'POST',
      actor: owner,
    });
    expect(link.statusCode).toBe(404);

    await ownerDb.insert(workspaceExports).values({
      workspaceId: workspace.id,
      requestedBy: owner.id,
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    const dead = (await request(base(workspace.id), { actor: owner })).json().exports;
    expect(dead.find((e: { status: string }) => e.status === 'failed')?.error).toContain(
      'did not finish',
    );
    expect((await request(base(workspace.id), { method: 'POST', actor: owner })).statusCode).toBe(
      202,
    );
  });

  test('deleting the workspace queues its export files for removal', async () => {
    const { owner, workspace } = await setUp();
    const exportId = (await request(base(workspace.id), { method: 'POST', actor: owner })).json()
      .export.id as string;
    await runJobs();
    const { ownerDb } = await getHarness();
    const [row] = await ownerDb
      .select()
      .from(workspaceExports)
      .where(eq(workspaceExports.id, exportId));
    const removed = await request(`/workspaces/${workspace.id}`, {
      method: 'DELETE',
      actor: owner,
      payload: { password: ACTOR_PASSWORD },
    });
    expect(removed.statusCode).toBeLessThan(300);
    const purges = await ownerDb.select().from(jobs).where(eq(jobs.kind, STORAGE_PURGE_JOB));
    const keys = purges.flatMap(
      (job) => (JSON.parse(String(job.payload)) as { keys: string[] }).keys,
    );
    expect(keys.filter((key) => key === row!.storageKey).length).toBeGreaterThanOrEqual(2);
  });

  test('a download link is kept out of the logs', () => {
    expect(loggableUrl('/workspaces/w1/exports/e1/download/abc123')).toBe(
      '/workspaces/w1/exports/e1/download/[token]',
    );
    expect(loggableUrl('/workspaces/w1/exports')).toBe('/workspaces/w1/exports');
  });
});
