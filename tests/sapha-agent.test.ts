import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { saphaConversations, saphaMessages } from '@robis/database';
import {
  SAPHA_AGENT_STEPS,
  SAPHA_CALLS_PER_STEP,
  SAPHA_PROPOSALS_PER_ANSWER,
  SAPHA_TURNS_PER_DAY,
  type SaphaTurn,
} from '@robis/shared';
import { type AgentStep, ANSWER_NOW } from '@robis/worker/sapha-agent';
import { NO_ANSWER, saphaRetentionHandler, startingWithPerson } from '@robis/worker/sapha-reply';
import { eq } from 'drizzle-orm';
import {
  type Actor,
  addMember,
  agentCalls,
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  getHarness,
  request,
  resetDatabase,
  runSapha,
  setAgent,
} from './harness.ts';

/**
 * Sapha, the agent: a conversation in which it looks things up, as the
 * person, in a few steps, then answers. Done when: each step runs a checked
 * tool inside the person's workspace; a change is proposed, never made; the
 * answer links only issues it looked at; it stops after eight steps; a
 * failed step fails the turn and says so; a conversation is its owner's
 * alone, kept 30 days, cleared on request; off until assistance is on.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const none = {
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
const calls = (...made: { name: string; input: unknown }[]): AgentStep => ({
  text: '',
  calls: made.map((call, i) => ({ id: `call-${agentCalls.length}-${i}`, ...call })),
  cut: false,
});
const says = (text: string): AgentStep => ({ text, calls: [], cut: false });

async function team() {
  const owner = await createActor('Owner');
  const member = await createActor('Member');
  const workspace = await createWorkspace(owner);
  await addMember(owner, workspace.id, member, 'MEMBER');
  const ws = `/workspaces/${workspace.id}`;
  await request(`${ws}/assist`, { method: 'PUT', actor: owner, payload: { enabled: true } });
  const project = await createProject(owner, workspace.id, 'Web');
  const file = async (title: string) =>
    (
      await request(`${ws}/projects/${project.id}/issues`, {
        method: 'POST',
        actor: owner,
        payload: { title },
      })
    ).json().issue as { id: string; number: number };
  return { owner, member, workspace, ws, project, file };
}

/** Ask, let the worker answer, and read the conversation back. */
async function ask(actor: Actor, ws: string, text: string, conversationId?: string) {
  const asked = conversationId
    ? await request(`${ws}/sapha/conversations/${conversationId}/messages`, {
        method: 'POST',
        actor,
        payload: { text },
      })
    : await request(`${ws}/sapha/conversations`, { method: 'POST', actor, payload: { text } });
  expect(asked.statusCode).toBe(201);
  const id = conversationId ?? asked.json().conversation.id;
  await runSapha();
  const read = await request(`${ws}/sapha/conversations/${id}`, { actor });
  return { id, turns: read.json().turns as SaphaTurn[] };
}

describe('a question looked up and answered', () => {
  test('each step is a checked tool, said as a step, and the answer links what it looked at', async () => {
    const { owner, ws, file } = await team();
    await file('Fix login');
    setAgent([
      calls({ name: 'get_issue', input: { key: 'web-1' } }),
      says('WEB-1 is still to do.'),
    ]);
    const { turns } = await ask(owner, ws, 'how is WEB-1 going?');
    expect(turns.map((t) => [t.role, t.status])).toEqual([
      ['person', 'done'],
      ['sapha', 'done'],
    ]);
    expect(turns[1]).toMatchObject({
      text: 'WEB-1 is still to do.',
      steps: ['Looked at WEB-1'],
      issues: [expect.objectContaining({ key: 'WEB-1', title: 'Fix login' })],
      proposals: [],
    });
    const sent = agentCalls[1]!.turns.at(-1)!;
    expect(sent.role).toBe('results');
    expect(JSON.stringify(sent)).toContain('Fix login');
  });

  test('another workspace’s issue is not found, and the tool says so', async () => {
    const { owner, ws } = await team();
    const stranger = await createActor('Stranger');
    const theirs = await createWorkspace(stranger);
    await createProject(stranger, theirs.id, 'Secret');
    await request(`/workspaces/${theirs.id}/projects`, { actor: stranger });
    setAgent([calls({ name: 'get_issue', input: { key: 'SEC-1' } }), says('Not found.')]);
    await ask(owner, ws, 'what is SEC-1?');
    const results = agentCalls[1]!.turns.at(-1)!;
    expect(results).toMatchObject({ role: 'results', results: [{ isError: true }] });
    expect(JSON.stringify(results)).toContain('No issue SEC-1 in this workspace');
  });

  test('a tool it does not have, or input that does not hold, is said back, not run', async () => {
    const { owner, ws } = await team();
    setAgent([
      calls({ name: 'drop_tables', input: {} }, { name: 'get_issue', input: { key: 42 } }),
      says('I could not look.'),
    ]);
    await ask(owner, ws, 'do something');
    const results = agentCalls[1]!.turns.at(-1) as { results: { isError: boolean }[] };
    expect(results.results.map((r) => r.isError)).toEqual([true, true]);
  });
});

describe('changes', () => {
  test('proposed for a yes, never made; parts that do not hold are refused and said so', async () => {
    const { owner, ws, file } = await team();
    const issue = await file('Fix login');
    setAgent([
      calls(
        { name: 'propose', input: { ...none, kind: 'status', issueKey: 'WEB-1', status: 'DONE' } },
        {
          name: 'propose',
          input: { ...none, kind: 'status', issueKey: 'not a key', status: 'DONE' },
        },
        { name: 'propose', input: { ...none, kind: 'search', query: 'login' } },
      ),
      says('I proposed moving WEB-1 to done.'),
    ]);
    const { turns } = await ask(owner, ws, 'close WEB-1 please');
    expect(turns[1]!.proposals).toEqual([
      expect.objectContaining({ kind: 'status', issueKey: 'WEB-1', status: 'DONE' }),
    ]);
    expect(turns[1]!.steps).toEqual(['Proposed: Move WEB-1 to Done']);
    const results = agentCalls[1]!.turns.at(-1) as { results: { isError: boolean }[] };
    expect(results.results.map((r) => r.isError)).toEqual([false, true, true]);
    const still = (await request(`${ws}/issues/${issue.id}`, { actor: owner })).json().issue;
    expect(still.status).toBe('TODO');
  });
});

describe('how much one turn may do', () => {
  test('a few calls a step and a few changes an answer; the rest are refused, not run', async () => {
    const { owner, ws, file } = await team();
    for (let i = 0; i < 3; i++) await file(`Piece ${i}`);
    const close = (n: number) => ({
      name: 'propose',
      input: { kind: 'status', issueKey: `WEB-${n}`, status: 'DONE' },
    });
    setAgent([
      calls(
        ...Array.from({ length: SAPHA_CALLS_PER_STEP + 2 }, () => ({
          name: 'releases',
          input: {},
        })),
      ),
      calls(close(1), close(2), close(3), close(1)),
      calls(close(2), close(3), close(1)),
      says('Proposed what I could.'),
    ]);
    const { turns } = await ask(owner, ws, 'close everything');
    const first = agentCalls[1]!.turns.at(-1) as { results: { isError: boolean }[] };
    expect(first.results.filter((r) => r.isError)).toHaveLength(2);
    expect(turns[1]!.proposals).toHaveLength(SAPHA_PROPOSALS_PER_ANSWER);
  });

  test('a change names only the parts it needs', async () => {
    const { owner, ws, file } = await team();
    await file('Fix login');
    setAgent([
      calls({ name: 'propose', input: { kind: 'priority', issueKey: 'WEB-1', priority: 'HIGH' } }),
      says('Proposed.'),
    ]);
    const { turns } = await ask(owner, ws, 'make WEB-1 high priority');
    expect(turns[1]!.proposals).toEqual([
      expect.objectContaining({
        kind: 'priority',
        issueKey: 'WEB-1',
        priority: 'HIGH',
        status: null,
      }),
    ]);
  });
});

describe('a conversation', () => {
  test('a follow-up is sent with what was said before', async () => {
    const { owner, ws } = await team();
    setAgent([says('There are no releases yet.')]);
    const first = await ask(owner, ws, 'any releases?');
    setAgent([says('Still none.')]);
    const { turns } = await ask(owner, ws, 'and now?', first.id);
    expect(turns.map((t) => t.text)).toEqual([
      'any releases?',
      'There are no releases yet.',
      'and now?',
      'Still none.',
    ]);
    expect(agentCalls[0]!.turns).toEqual([
      { role: 'person', text: 'any releases?' },
      { role: 'sapha', text: 'There are no releases yet.', calls: [] },
      { role: 'person', text: 'and now?' },
    ]);
  });

  test('at most eight steps, then it is asked to answer with no tools left', async () => {
    const { owner, ws } = await team();
    setAgent([
      ...Array.from({ length: SAPHA_AGENT_STEPS }, () => calls({ name: 'releases', input: {} })),
      says('Here is what I found.'),
    ]);
    const { turns } = await ask(owner, ws, 'keep looking');
    expect(agentCalls).toHaveLength(SAPHA_AGENT_STEPS + 1);
    expect(agentCalls.at(-1)!.final).toBe(true);
    expect(agentCalls.at(-1)!.turns.at(-1)).toEqual({ role: 'person', text: ANSWER_NOW });
    expect(turns[1]).toMatchObject({ status: 'done', text: 'Here is what I found.' });
  });

  test('a failed step, a cut-off call or no words fails the turn, and it says so', async () => {
    const { owner, ws } = await team();
    for (const script of [
      [null],
      ['throw' as const],
      [{ ...calls({ name: 'releases', input: {} }), cut: true }],
      [says('  ')],
    ]) {
      setAgent(script);
      const { turns } = await ask(owner, ws, 'hello');
      expect(turns.at(-1)).toMatchObject({ status: 'failed', text: NO_ANSWER });
    }
  });

  test('one answer at a time: another while one waits is refused', async () => {
    const { owner, ws } = await team();
    const started = await request(`${ws}/sapha/conversations`, {
      method: 'POST',
      actor: owner,
      payload: { text: 'first' },
    });
    const again = await request(
      `${ws}/sapha/conversations/${started.json().conversation.id}/messages`,
      { method: 'POST', actor: owner, payload: { text: 'second' } },
    );
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('still_answering');
  });
});

describe('whose it is', () => {
  test('only its owner reads it; off until assistance is on', async () => {
    const { owner, member, ws } = await team();
    setAgent([says('Hello.')]);
    const { id } = await ask(owner, ws, 'hello');
    expect((await request(`${ws}/sapha/conversations/${id}`, { actor: member })).statusCode).toBe(
      404,
    );
    expect(
      (await request(`${ws}/sapha/conversations`, { actor: member })).json().conversations,
    ).toEqual([]);
    await request(`${ws}/assist`, { method: 'PUT', actor: owner, payload: { enabled: false } });
    const off = await request(`${ws}/sapha/conversations`, {
      method: 'POST',
      actor: owner,
      payload: { text: 'hello' },
    });
    expect(off.statusCode).toBe(404);
  });

  test('turned off while a turn waits: nothing is sent, and the turn fails', async () => {
    const { owner, ws } = await team();
    setAgent([says('Hello.')]);
    const started = await request(`${ws}/sapha/conversations`, {
      method: 'POST',
      actor: owner,
      payload: { text: 'hello' },
    });
    await request(`${ws}/assist`, { method: 'PUT', actor: owner, payload: { enabled: false } });
    await runSapha();
    expect(agentCalls).toEqual([]);
    const { ownerDb } = await getHarness();
    const rows = await ownerDb
      .select({ status: saphaMessages.status })
      .from(saphaMessages)
      .where(eq(saphaMessages.conversationId, started.json().conversation.id));
    expect(rows.map((r) => r.status).sort()).toEqual(['done', 'failed']);
  });

  test('cleared on request, one or all; kept no longer than 30 days', async () => {
    const { owner, ws } = await team();
    setAgent([says('One.')]);
    const one = await ask(owner, ws, 'one');
    setAgent([says('Two.')]);
    const two = await ask(owner, ws, 'two');
    expect(
      (await request(`${ws}/sapha/conversations/${one.id}`, { method: 'DELETE', actor: owner }))
        .statusCode,
    ).toBe(204);
    expect(
      (await request(`${ws}/sapha/conversations`, { actor: owner })).json().conversations,
    ).toEqual([expect.objectContaining({ id: two.id, title: 'two' })]);
    const { ownerDb, workerDb } = await getHarness();
    await ownerDb
      .update(saphaConversations)
      .set({ updatedAt: new Date(Date.now() - 31 * 86_400_000) })
      .where(eq(saphaConversations.id, two.id));
    await saphaRetentionHandler()({}, { db: workerDb } as never);
    expect(
      (await request(`${ws}/sapha/conversations`, { actor: owner })).json().conversations,
    ).toEqual([]);
    setAgent([says('Three.')]);
    await ask(owner, ws, 'three');
    await request(`${ws}/sapha/conversations`, { method: 'DELETE', actor: owner });
    expect(
      (await request(`${ws}/sapha/conversations`, { actor: owner })).json().conversations,
    ).toEqual([]);
  });

  test('a day’s questions are bounded', async () => {
    const { owner, ws } = await team();
    setAgent([says('One.')]);
    const { id } = await ask(owner, ws, 'one');
    const { ownerDb } = await getHarness();
    await ownerDb.insert(saphaMessages).values(
      Array.from({ length: SAPHA_TURNS_PER_DAY }, () => ({
        conversationId: id,
        role: 'person' as const,
        text: 'again',
      })),
    );
    const refused = await request(`${ws}/sapha/conversations`, {
      method: 'POST',
      actor: owner,
      payload: { text: 'one more' },
    });
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error).toBe('sapha_daily_limit');
  });
});

describe('what is sent again', () => {
  test('the exchange starts with the person, never with an answer cut from its question', () => {
    const row = (role: 'person' | 'sapha', text: string) => ({ role, text });
    expect(
      startingWithPerson([row('sapha', 'An answer'), row('person', 'Next'), row('sapha', 'Yes')]),
    ).toEqual([row('person', 'Next'), row('sapha', 'Yes')]);
    expect(startingWithPerson([row('sapha', 'Only an answer')])).toEqual([]);
  });
});
