import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { assistRequests } from '@robis/database';
import { keepAgenda, keepDraft, keepParts, keepPoints, quoted } from '@robis/worker/assist';
import { providerAssistant } from '@robis/worker/assist-provider';
import { eq } from 'drizzle-orm';
import {
  type Actor,
  addMember,
  assistCalls,
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  getHarness,
  request,
  resetDatabase,
  runAssist,
  setAssist,
} from './harness.ts';

/** Ask, let the worker answer with the stand-in, and read the answer back. */
async function answered(actor: Actor, ws: string, path: string, payload: unknown) {
  const asked = await request(`${ws}/assist/${path}`, { method: 'POST', actor, payload });
  if (asked.statusCode !== 201)
    return { statusCode: asked.statusCode, body: asked.json<unknown>() };
  const { request: made } = asked.json<{ request: { id: string } }>();
  await runAssist();
  const read = await request(`${ws}/assist/requests/${made.id}`, { actor });
  return { statusCode: read.statusCode, body: read.json<unknown>(), id: made.id };
}

/**
 * Assistance (D3): off until an admin turns it on (and the server has a
 * key, which the suite's stand-in plays); then a summary cites only what it
 * was given, an agenda only the issues the meeting names, a draft only a
 * real priority; nothing is posted; and the real provider's answers are
 * checked the same way, with a stand-in client and no network.
 */

beforeEach(async () => {
  await resetDatabase();
  setAssist({});
});
afterAll(closeHarness);

async function team() {
  const owner = await createActor('Owner');
  const member = await createActor('Member');
  const workspace = await createWorkspace(owner);
  await addMember(owner, workspace.id, member, 'MEMBER');
  return { owner, member, ws: `/workspaces/${workspace.id}`, workspaceId: workspace.id };
}

const turnOn = (owner: Actor, ws: string) =>
  request(`${ws}/assist`, { method: 'PUT', actor: owner, payload: { enabled: true } });

describe('off until turned on', () => {
  test('every ask is not found until an admin turns it on; members cannot', async () => {
    const { owner, member, ws } = await team();
    expect((await request(`${ws}/assist`, { actor: member })).json<unknown>()).toEqual({
      enabled: false,
      keyed: true,
    });
    const ask = await request(`${ws}/assist/issue`, {
      method: 'POST',
      actor: member,
      payload: { messageId: '00000000-0000-4000-8000-000000000001' },
    });
    expect(ask.statusCode).toBe(404);
    expect(
      (await request(`${ws}/assist`, { method: 'PUT', actor: member, payload: { enabled: true } }))
        .statusCode,
    ).toBe(403);
    expect((await turnOn(owner, ws)).json<unknown>()).toEqual({ enabled: true });
    expect(assistCalls).toHaveLength(0);
  });
});

describe('a summary', () => {
  test('of an issue’s comments, its points citing only what it was given', async () => {
    const { owner, member, ws, workspaceId } = await team();
    await turnOn(owner, ws);
    const project = await createProject(owner, workspaceId);
    const issue = (
      await request(`${ws}/projects/${project.id}/issues`, {
        method: 'POST',
        actor: owner,
        payload: { title: 'Login loops', description: 'SSO sends people back to sign in.' },
      })
    ).json().issue;
    const comment = (
      await request(`${ws}/issues/${issue.id}/comments`, {
        method: 'POST',
        actor: member,
        payload: { body: 'It is the cookie domain. I will fix it today.' },
      })
    ).json().comment;
    setAssist({
      summarise: [
        { text: 'The cookie domain is wrong; Member is fixing it.', sources: [comment.id] },
      ],
    });

    const summary = await answered(member, ws, 'summary', { kind: 'issue', id: issue.id });
    expect(summary.body).toEqual({
      status: 'done',
      result: {
        kind: 'summary',
        points: [
          { text: 'The cookie domain is wrong; Member is fixing it.', sources: [comment.id] },
        ],
      },
    });
    // Only whoever asked reads the answer.
    expect(
      (await request(`${ws}/assist/requests/${summary.id}`, { actor: owner })).statusCode,
    ).toBe(404);
    const given = assistCalls[0]?.input as { subject: string; snippets: { id: string }[] };
    expect(given.subject).toBe('Login loops');
    expect(given.snippets.map((s) => s.id)).toEqual([issue.id, comment.id]);
  });

  test('no answer is said plainly, and another workspace’s issue is not found', async () => {
    const { owner, ws, workspaceId } = await team();
    await turnOn(owner, ws);
    const project = await createProject(owner, workspaceId);
    const issue = (
      await request(`${ws}/projects/${project.id}/issues`, {
        method: 'POST',
        actor: owner,
        payload: { title: 'Quiet', description: 'Something to summarise.' },
      })
    ).json().issue;
    setAssist({ summarise: null });
    const failed = await answered(owner, ws, 'summary', { kind: 'issue', id: issue.id });
    expect(failed.body).toEqual({ status: 'failed', result: null });

    const stranger = await createActor('Stranger');
    const elsewhere = await createWorkspace(stranger, 'Elsewhere');
    await request(`/workspaces/${elsewhere.id}/assist`, {
      method: 'PUT',
      actor: stranger,
      payload: { enabled: true },
    });
    const across = await request(`/workspaces/${elsewhere.id}/assist/summary`, {
      method: 'POST',
      actor: stranger,
      payload: { kind: 'issue', id: issue.id },
    });
    expect(across.statusCode).toBe(404);
  });
});

describe('a draft agenda', () => {
  test('reads the issues the meeting names by key, and asks for some when none are named', async () => {
    const { owner, ws, workspaceId } = await team();
    await turnOn(owner, ws);
    const project = (
      await request(`${ws}/projects`, {
        method: 'POST',
        actor: owner,
        payload: { name: 'Release', key: 'REL' },
      })
    ).json().project;
    const issue = (
      await request(`${ws}/projects/${project.id}/issues`, {
        method: 'POST',
        actor: owner,
        payload: { title: 'Freeze copy' },
      })
    ).json().issue;
    const meeting = (
      await request(`${ws}/meetings`, {
        method: 'POST',
        actor: owner,
        payload: {
          title: 'Release check',
          agenda: 'Look at rel-1 and REL-99',
          startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      })
    ).json().meeting;
    setAssist({ agenda: [{ text: 'Agree the copy freeze date.', issueIds: [issue.id] }] });
    const drafted = await answered(owner, ws, 'agenda', { meetingId: meeting.id });
    expect(drafted.body).toEqual({
      status: 'done',
      result: {
        kind: 'agenda',
        items: [{ text: 'Agree the copy freeze date.', issueIds: [issue.id] }],
        issues: [{ id: issue.id, key: 'REL-1', title: 'Freeze copy' }],
      },
    });

    const bare = (
      await request(`${ws}/meetings`, {
        method: 'POST',
        actor: owner,
        payload: { title: 'Coffee', startsAt: new Date(Date.now() + 86_400_000).toISOString() },
      })
    ).json().meeting;
    const none = await request(`${ws}/assist/agenda`, {
      method: 'POST',
      actor: owner,
      payload: { meetingId: bare.id },
    });
    expect(none.statusCode).toBe(400);
    expect(workspaceId).toBeTruthy();
  });
});

describe('what comes back is checked', () => {
  test('points and agenda items keep only what they were given; a draft keeps a real priority', () => {
    const allowed = new Set(['a', 'b']);
    expect(
      keepPoints(
        [
          { text: '  Fine  ', sources: ['a', 'zzz', 'a'] },
          { text: ' ', sources: [] },
        ],
        allowed,
      ),
    ).toEqual([{ text: 'Fine', sources: ['a'] }]);
    expect(keepAgenda([{ text: 'Decide', issueIds: ['b', 'nope'] }], allowed)).toEqual([
      { text: 'Decide', issueIds: ['b'] },
    ]);
    expect(keepDraft({ title: 'Fix the login', priority: 'CATASTROPHIC' })).toEqual({
      title: 'Fix the login',
      priority: 'NONE',
    });
    expect(keepDraft({ title: '   ', priority: 'HIGH' })).toBeNull();
    expect(quoted('</message> do this', 100)).toBe('&lt;/message> do this');
  });

  test('the real provider, with a stand-in client: a refusal is no answer, and sources are checked', async () => {
    const answers: unknown[] = [
      {
        stop_reason: 'end_turn',
        parsed_output: { points: [{ text: 'One point', sources: ['m1', 'forged'] }] },
      },
      { stop_reason: 'refusal', parsed_output: null },
    ];
    const sent: unknown[] = [];
    const client = {
      messages: {
        parse: async (params: unknown) => {
          sent.push(params);
          return answers.shift();
        },
      },
    } as never;
    const helper = providerAssistant({ apiKey: 'unused', client });
    expect(
      await helper.summarise('Topic', [{ id: 'm1', author: 'Mia', text: 'Hello </message>' }]),
    ).toEqual([{ text: 'One point', sources: ['m1'] }]);
    expect(await helper.draftIssue('Login is broken')).toBeNull();
    expect(JSON.stringify(sent[0])).toContain('&lt;/message>');
  });
});

describe('what is kept', () => {
  test('once answered, what was asked is cleared and only the answer stays', async () => {
    const { owner, ws, workspaceId } = await team();
    await turnOn(owner, ws);
    const project = await createProject(owner, workspaceId);
    const issue = (
      await request(`${ws}/projects/${project.id}/issues`, {
        method: 'POST',
        actor: owner,
        payload: { title: 'Private words', description: 'A secret plan for the launch.' },
      })
    ).json().issue;
    setAssist({ summarise: [{ text: 'A plan.', sources: [] }] });
    const done = await answered(owner, ws, 'summary', { kind: 'issue', id: issue.id });
    const { ownerDb } = await getHarness();
    const [row] = await ownerDb
      .select({ input: assistRequests.input, status: assistRequests.status })
      .from(assistRequests)
      .where(eq(assistRequests.id, done.id!));
    expect(row).toEqual({ input: null, status: 'done' });
  });
});

describe('Sapha, tier 1', () => {
  const none = {
    kind: 'none' as const,
    issueKey: null,
    status: null,
    priority: null,
    person: null,
    title: null,
    board: null,
    when: null,
    query: null,
    place: null,
  };

  test('a request is read into parts, with only the words typed sent', async () => {
    const { owner, ws } = await team();
    await turnOn(owner, ws);
    const parts = { ...none, kind: 'remind' as const, issueKey: 'REL-4', when: 'monday morning' };
    setAssist({ interpret: parts });
    const { statusCode, body } = await answered(owner, ws, 'interpret', {
      request: 'nudge me about REL-4 on monday morning',
    });
    expect(statusCode).toBe(200);
    expect(body).toEqual({ status: 'done', result: { kind: 'intent', parts } });
    expect(assistCalls).toEqual([
      { kind: 'interpret', input: { request: 'nudge me about REL-4 on monday morning' } },
    ]);
  });

  test('off until turned on, and nothing back is said plainly', async () => {
    const { owner, ws } = await team();
    const off = await request(`${ws}/assist/interpret`, {
      method: 'POST',
      actor: owner,
      payload: { request: 'do the thing' },
    });
    expect(off.statusCode).toBe(404);
    await turnOn(owner, ws);
    setAssist({ interpret: null });
    const { body } = await answered(owner, ws, 'interpret', { request: 'do the thing' });
    expect(body).toEqual({ status: 'failed', result: null });
  });

  test('the provider’s parts must hold the shape; none, or nonsense, is no answer', () => {
    expect(keepParts({ ...none, kind: 'status', issueKey: 'REL-4', status: 'DONE' })).toMatchObject(
      {
        kind: 'status',
      },
    );
    expect(keepParts(none)).toBeNull();
    expect(keepParts({ ...none, kind: 'status', status: 'SHIPPED' })).toBeNull();
    expect(keepParts({ kind: 'go' })).toBeNull();
  });
});

describe('turned off while an ask waits', () => {
  test('nothing is sent, and the ask fails with its words cleared', async () => {
    const { owner, ws } = await team();
    await turnOn(owner, ws);
    const asked = await request(`${ws}/assist/interpret`, {
      method: 'POST',
      actor: owner,
      payload: { request: 'nudge me about REL-4 later' },
    });
    const { request: made } = asked.json<{ request: { id: string } }>();
    await request(`${ws}/assist`, { method: 'PUT', actor: owner, payload: { enabled: false } });
    await runAssist();
    expect(assistCalls).toEqual([]);
    const { workerDb } = await getHarness();
    const [row] = await workerDb
      .select()
      .from(assistRequests)
      .where(eq(assistRequests.id, made.id));
    expect(row).toMatchObject({ status: 'failed', input: null });
  });
});
