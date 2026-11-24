import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { runApiJobs } from '@robis/api/automation-runner';
import { runExportJob } from '@robis/api/export-job';
import { parseCsv } from '@robis/api/imports-csv';
import { priorityFrom, statusFrom } from '@robis/api/imports-model';
import { WORKSPACE_EXPORT_JOB } from '@robis/database';
import { localDiskStorage, writeZip } from '@robis/storage';
import {
  type Actor,
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
 * Importing issues (C6). Done when: export followed by import into a fresh
 * workspace reproduces issues, comments and labels; a CSV maps statuses,
 * priorities and labels; and running either import again creates nothing.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

type Issue = { id: string; title: string; status: string; priority: string; labelIds?: string[] };

async function upload(actor: Actor, path: string, type: string, body: string | Uint8Array) {
  return request(path, {
    method: 'POST',
    actor,
    payload: typeof body === 'string' ? body : Buffer.from(body),
    headers: { 'content-type': type },
  });
}

/** A board's issues, with each one's label names and comment bodies. */
async function boardOf(actor: Actor, workspaceId: string, projectId: string) {
  const issues = (
    await request(`/workspaces/${workspaceId}/projects/${projectId}/issues`, { actor })
  ).json().issues as Issue[];
  const labels = (await request(`/workspaces/${workspaceId}/labels`, { actor })).json().labels as {
    id: string;
    name: string;
  }[];
  const nameOf = new Map(labels.map((l) => [l.id, l.name]));
  const out = [];
  for (const issue of issues) {
    const thread = (
      await request(`/workspaces/${workspaceId}/issues/${issue.id}/comments`, { actor })
    ).json().comments as { body: string }[];
    out.push({
      title: issue.title,
      status: issue.status,
      priority: issue.priority,
      labels: (issue.labelIds ?? []).map((id) => nameOf.get(id)).sort(),
      comments: thread.map((c) => c.body),
    });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

describe('a CSV file', () => {
  test('is read with quotes, commas and line breaks inside fields', () => {
    const text = '﻿title,description\r\n"Fix ""login""","one, two\nthree"\r\nPlain,\n';
    expect(parseCsv(text)).toEqual([
      ['title', 'description'],
      ['Fix "login"', 'one, two\nthree'],
      ['Plain', ''],
    ]);
    expect(statusFrom('In Progress')).toBe('IN_PROGRESS');
    expect(statusFrom('closed')).toBe('DONE');
    expect(statusFrom('whatever')).toBe('TODO');
    expect(priorityFrom('P0')).toBe('URGENT');
    expect(priorityFrom('high')).toBe('HIGH');
  });

  test('imports with statuses, priorities and labels mapped, once', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const project = await createProject(owner, workspace.id);
    const path = `/workspaces/${workspace.id}/projects/${project.id}/import/csv`;
    const csv = [
      'Title,Status,Priority,Labels,ID',
      'Write the docs,done,low,docs;writing,1',
      'Fix the build,in progress,P0,ci,2',
      ',todo,,,3',
    ].join('\n');
    const first = await upload(owner, path, 'text/csv', csv);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ found: 2, created: 2, skipped: 0, labelsCreated: 3 });
    expect(first.json().problems).toEqual([{ row: 4, reason: 'No title' }]);

    const board = await boardOf(owner, workspace.id, project.id);
    expect(board).toEqual([
      {
        title: 'Fix the build',
        status: 'IN_PROGRESS',
        priority: 'URGENT',
        labels: ['ci'],
        comments: [],
      },
      {
        title: 'Write the docs',
        status: 'DONE',
        priority: 'LOW',
        labels: ['docs', 'writing'],
        comments: [],
      },
    ]);
    const again = await upload(owner, path, 'text/csv', csv);
    expect(again.json()).toMatchObject({ created: 0, skipped: 2, labelsCreated: 0 });
    expect(await boardOf(owner, workspace.id, project.id)).toHaveLength(2);
  });

  test('a guest cannot import; a file with no title column says so', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const project = await createProject(owner, workspace.id);
    const guest = await createActor('Guest');
    await addMember(owner, workspace.id, guest, 'GUEST');
    const path = `/workspaces/${workspace.id}/projects/${project.id}/import/csv`;
    expect((await upload(guest, path, 'text/csv', 'title\nA')).statusCode).toBe(403);
    const none = await upload(owner, path, 'text/csv', 'name-less,thing\na,b');
    expect(none.json().problems[0].reason).toContain('No title column');
  });
});

describe('limits on an import', () => {
  test('a very long id still imports once; labels stop at twenty an issue and a hundred new', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const project = await createProject(owner, workspace.id);
    const path = `/workspaces/${workspace.id}/projects/${project.id}/import/csv`;
    const longId = 'x'.repeat(5000);
    const many = Array.from({ length: 30 }, (_, i) => `l${i}`).join(';');
    const csv = `title,id,labels\nLong one,${longId},${many}\n`;
    const first = await upload(owner, path, 'text/csv', csv);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ created: 1 });
    const [issue] = (
      await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, { actor: owner })
    ).json().issues as Issue[];
    expect(issue!.labelIds).toHaveLength(20);
    expect((await upload(owner, path, 'text/csv', csv)).json()).toMatchObject({ skipped: 1 });

    const tooMany = Array.from({ length: 101 }, (_, i) => `n${i}`).join(';');
    const refused = await upload(owner, path, 'text/csv', `title,labels\nToo many,${tooMany}\n`);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().message).toContain('at most 100');
  });

  test('a file over the size taken is refused before it is read', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const project = await createProject(owner, workspace.id);
    const path = `/workspaces/${workspace.id}/projects/${project.id}/import/csv`;
    const big = `title\n${'a'.repeat(1024 * 1024 + 10)}\n`;
    expect((await upload(owner, path, 'text/csv', big)).statusCode).toBe(413);
  });
});

describe('a Robis export', () => {
  test('imported into a fresh workspace reproduces issues, comments and labels', async () => {
    // A workspace with labelled, commented issues at several stages.
    const owner = await createActor('Owner');
    const source = await createWorkspace(owner, 'Source');
    const sourceProject = await createProject(owner, source.id, 'Origin');
    const label = async (name: string, colour: string) =>
      (
        await request(`/workspaces/${source.id}/labels`, {
          method: 'POST',
          actor: owner,
          payload: { name, colour },
        })
      ).json().label.id as string;
    const bug = await label('bug', 'rose');
    const ui = await label('ui', 'sky');
    const file = async (title: string, status: string, priority: string, labelIds: string[]) => {
      const issue = (
        await request(`/workspaces/${source.id}/projects/${sourceProject.id}/issues`, {
          method: 'POST',
          actor: owner,
          payload: { title, status, priority },
        })
      ).json().issue as { id: string };
      await request(`/workspaces/${source.id}/issues/${issue.id}/labels`, {
        method: 'PUT',
        actor: owner,
        payload: { labelIds },
      });
      return issue.id;
    };
    const first = await file('Menu overlaps the header', 'IN_PROGRESS', 'HIGH', [bug, ui]);
    await file('Add a dark theme', 'TODO', 'LOW', [ui]);
    await file('Ship version one', 'DONE', 'URGENT', []);
    for (const body of ['Seen on a phone', 'Fixed on the branch']) {
      await request(`/workspaces/${source.id}/issues/${first}/comments`, {
        method: 'POST',
        actor: owner,
        payload: { body },
      });
    }

    // Export it, and fetch the zip.
    const exportId = (
      await request(`/workspaces/${source.id}/exports`, { method: 'POST', actor: owner })
    ).json().export.id as string;
    const { db } = await getHarness();
    const storage = localDiskStorage(MEDIA_ROOT);
    await runApiJobs(
      db,
      'test',
      { error() {} },
      {
        [WORKSPACE_EXPORT_JOB]: (payload) => runExportJob(db, storage, payload),
      },
    );
    const url = (
      await request(`/workspaces/${source.id}/exports/${exportId}/link`, {
        method: 'POST',
        actor: owner,
      })
    ).json().url as string;
    const zip = (await request(url.replace(/^\/api/, ''), { actor: owner })).rawPayload;

    // Into a fresh workspace, by someone else.
    const other = await createActor('Other');
    const target = await createWorkspace(other, 'Target');
    const targetProject = await createProject(other, target.id, 'Landing');
    const path = `/workspaces/${target.id}/projects/${targetProject.id}/import/robis`;
    const landed = await upload(other, path, 'application/zip', new Uint8Array(zip));
    expect(landed.statusCode).toBe(200);
    expect(landed.json()).toMatchObject({ found: 3, created: 3, labelsCreated: 2, comments: 2 });

    const before = await boardOf(owner, source.id, sourceProject.id);
    const after = await boardOf(other, target.id, targetProject.id);
    expect(after).toEqual(before);

    const again = await upload(other, path, 'application/zip', new Uint8Array(zip));
    expect(again.json()).toMatchObject({ created: 0, skipped: 3, comments: 0 });
    expect(await boardOf(other, target.id, targetProject.id)).toHaveLength(3);
  });

  test('a zip that is not an export is refused', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const project = await createProject(owner, workspace.id);
    const path = `/workspaces/${workspace.id}/projects/${project.id}/import/robis`;
    const notExport = writeZip([{ name: 'hello.txt', data: new TextEncoder().encode('hi') }]);
    const refused = await upload(owner, path, 'application/zip', notExport);
    expect(refused.statusCode).toBe(400);
    expect(
      (await upload(owner, path, 'application/zip', new Uint8Array([1, 2, 3]))).statusCode,
    ).toBe(400);
  });
});
