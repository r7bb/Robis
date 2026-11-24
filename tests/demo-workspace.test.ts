import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { loadDocument } from '@robis/database';
import { DEMO_WORKSPACE, demoMeetingStart, wallOf } from '@robis/shared';
import { closeHarness, createActor, getHarness, request, resetDatabase } from './harness.ts';

/**
 * The demo workspace (C5). Done when: one request makes a workspace marked
 * as a demo, with a board of issues at every stage, a document with words
 * in it, a channel beside #general and a meeting coming up in working
 * hours where the person is; asking again returns the same one; and the
 * workspace list says which is the demo.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

/** Today in London, as the demo below is made there. */
const wallDay = (now: Date) => {
  const wall = wallOf(now, 'Europe/London');
  return `${wall.year}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`;
};

type Made = {
  workspace: { id: string; demo: boolean; role: string; name: string };
  projectId: string;
};

async function makeDemo(timeZone?: string) {
  const owner = await createActor('Owner');
  const response = await request('/workspaces/demo', {
    method: 'POST',
    actor: owner,
    payload: timeZone ? { timeZone } : {},
  });
  return { owner, response, made: response.json() as Made };
}

describe('the demo workspace', () => {
  test('arrives with issues at every stage, a document, a channel and a meeting', async () => {
    const { owner, response, made } = await makeDemo('Europe/London');
    expect(response.statusCode).toBe(201);
    expect(made.workspace).toMatchObject({ demo: true, role: 'OWNER', name: 'Demo workspace' });
    const base = `/workspaces/${made.workspace.id}`;

    const issues = (
      await request(`${base}/projects/${made.projectId}/issues`, { actor: owner })
    ).json().issues as { title: string; status: string; position: string }[];
    const byBoard = [...issues].sort((a, b) => (a.position < b.position ? -1 : 1));
    expect(byBoard.map((i) => i.title)).toEqual(DEMO_WORKSPACE.issues.map((i) => i.title));
    expect(new Set(issues.map((i) => i.status))).toEqual(
      new Set(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']),
    );

    const docs = (await request(`${base}/documents`, { actor: owner })).json().documents as {
      id: string;
      title: string;
    }[];
    expect(docs.map((d) => d.title)).toEqual([DEMO_WORKSPACE.document.title]);
    const { db } = await getHarness();
    const text = (await loadDocument(db, docs[0]!.id)).getText('content').toString();
    expect(text).toBe(DEMO_WORKSPACE.document.body);

    const channels = (await request(`${base}/channels`, { actor: owner })).json().channels as {
      name: string;
    }[];
    expect(channels.map((c) => c.name).sort()).toEqual(['general', 'relaunch']);

    const meetings = (await request(`${base}/meetings`, { actor: owner })).json().meetings as {
      title: string;
      startsAt: string;
      timeZone: string;
    }[];
    expect(meetings).toHaveLength(1);
    expect(meetings[0]!.timeZone).toBe('Europe/London');
    const starts = new Date(meetings[0]!.startsAt);
    expect(starts.getTime()).toBeGreaterThan(Date.now());
    expect(wallOf(starts, 'Europe/London')).toMatchObject({ hour: 10, minute: 0 });
  });

  test('arrives as a team would have it: an update, a blocked issue, a repeat and meeting notes', async () => {
    const { owner, made } = await makeDemo('Europe/London');
    const base = `/workspaces/${made.workspace.id}`;
    const updates = (
      await request(`${base}/projects/${made.projectId}/updates`, { actor: owner })
    ).json();
    expect(updates.updates).toEqual([
      expect.objectContaining({ health: 'at_risk', body: DEMO_WORKSPACE.update.body }),
    ]);

    const blocked = (
      await request(`${base}/projects/${made.projectId}/blocked`, { actor: owner })
    ).json();
    expect(blocked.issueIds).toHaveLength(1);

    const repeats = (
      await request(`${base}/projects/${made.projectId}/repeats`, { actor: owner })
    ).json();
    expect(repeats.repeats).toEqual([
      expect.objectContaining({
        title: DEMO_WORKSPACE.repeat.title,
        cadence: 'weekly',
        timeZone: 'Europe/London',
      }),
    ]);

    const planned = (
      await request(`${base}/projects/${made.projectId}/cycles`, { actor: owner })
    ).json();
    const notDone = DEMO_WORKSPACE.issues.filter((issue) => issue.status !== 'DONE').length;
    expect(planned.cycles).toEqual([
      expect.objectContaining({ name: DEMO_WORKSPACE.cycle.name, total: notDone, done: 0 }),
    ]);

    const templates = (await request(`${base}/issue-templates`, { actor: owner })).json();
    expect(templates.templates).toEqual([
      expect.objectContaining({ name: DEMO_WORKSPACE.template.name, priority: 'HIGH' }),
    ]);
    const releases = (await request(`${base}/releases`, { actor: owner })).json();
    const inRelease = DEMO_WORKSPACE.issues.filter((issue) =>
      (DEMO_WORKSPACE.release.issues as readonly string[]).includes(issue.title),
    );
    expect(releases.releases).toEqual([
      expect.objectContaining({
        name: DEMO_WORKSPACE.release.name,
        shippedAt: null,
        total: inRelease.length,
        done: inRelease.filter((issue) => issue.status === 'DONE').length,
      }),
    ]);
    expect(releases.releases[0].targetOn > wallDay(new Date())).toBe(true);

    const meetings = (await request(`${base}/meetings`, { actor: owner })).json();
    const notes = (
      await request(`${base}/meetings/${meetings.meetings[0].id}/notes`, { actor: owner })
    ).json();
    expect(notes.notes).toContain('- [ ] Ask legal to read the pricing page');
  });

  test('asking again returns the same demo rather than another', async () => {
    const { owner, made } = await makeDemo();
    const again = await request('/workspaces/demo', { method: 'POST', actor: owner, payload: {} });
    expect(again.statusCode).toBe(201);
    expect((again.json() as Made).workspace.id).toBe(made.workspace.id);
    const listed = (await request('/workspaces', { actor: owner })).json().workspaces as {
      id: string;
      demo: boolean;
    }[];
    expect(listed.filter((w) => w.demo).map((w) => w.id)).toEqual([made.workspace.id]);
  });

  test('two requests at once make one demo', async () => {
    const owner = await createActor('Owner');
    const ask = () => request('/workspaces/demo', { method: 'POST', actor: owner, payload: {} });
    const [first, second] = await Promise.all([ask(), ask()]);
    expect((first.json() as Made).workspace.id).toBe((second.json() as Made).workspace.id);
    const listed = (await request('/workspaces', { actor: owner })).json().workspaces as {
      demo: boolean;
    }[];
    expect(listed.filter((w) => w.demo)).toHaveLength(1);
  });

  test('a demo whose board was deleted is found again and given a new board', async () => {
    const { owner, made } = await makeDemo();
    const base = `/workspaces/${made.workspace.id}`;
    const removed = await request(`${base}/projects/${made.projectId}`, {
      method: 'DELETE',
      actor: owner,
    });
    expect(removed.statusCode).toBeLessThan(300);
    const again = (
      await request('/workspaces/demo', { method: 'POST', actor: owner, payload: {} })
    ).json() as Made;
    expect(again.workspace.id).toBe(made.workspace.id);
    expect(again.projectId).not.toBe(made.projectId);
    const issues = (
      await request(`${base}/projects/${again.projectId}/issues`, { actor: owner })
    ).json().issues as unknown[];
    expect(issues).toHaveLength(DEMO_WORKSPACE.issues.length);
  });

  test('a zone it does not know sets the meeting in UTC; signed out is refused', async () => {
    const { owner, made } = await makeDemo('Not/AZone');
    const meetings = (
      await request(`/workspaces/${made.workspace.id}/meetings`, { actor: owner })
    ).json().meetings as { timeZone: string }[];
    expect(meetings[0]!.timeZone).toBe('UTC');
    const anonymous = await request('/workspaces/demo', { method: 'POST', payload: {} });
    expect(anonymous.statusCode).toBe(401);
  });
});

describe('when the demo meeting starts', () => {
  test('10:00 local on the next weekday, skipping the weekend', () => {
    // Friday 2026-11-20, 15:00 in New York: the next weekday is Monday.
    const friday = new Date('2026-11-20T20:00:00Z');
    const start = demoMeetingStart(friday, 'America/New_York');
    expect(start.toISOString()).toBe('2026-11-23T15:00:00.000Z');
    // Tuesday in Tokyo: Wednesday 10:00 there.
    const tuesday = new Date('2026-11-24T03:00:00Z');
    expect(demoMeetingStart(tuesday, 'Asia/Tokyo').toISOString()).toBe('2026-11-25T01:00:00.000Z');
  });
});
