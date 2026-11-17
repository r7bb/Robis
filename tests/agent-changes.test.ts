import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  agentChanges,
  agentRuns,
  agentSteps,
  judgeAgentChanges,
  outcomeOfChange,
  pruneAgentHistory,
} from '@robis/database';
import { eq } from 'drizzle-orm';
import {
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  getHarness,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * Kept, edited or reverted (B6, slice 3): each change an agent makes is
 * stored with the value before and after, and judged once seven days old,
 * by the worker's own database account.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const DAY_MS = 24 * 60 * 60 * 1000;
const inEightDays = () => new Date(Date.now() + 8 * DAY_MS);

async function setUp() {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const project = await createProject(owner, workspace.id);
  const created = await request(`/workspaces/${workspace.id}/agents`, {
    method: 'POST',
    actor: owner,
    payload: { name: 'Change bot', role: 'MEMBER' },
  });
  const { agent, token } = created.json();
  const bot = { authorization: `Bearer ${token.secret}` };
  const issueBy = async (headers: Record<string, string> | null, title: string) =>
    (
      await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
        method: 'POST',
        ...(headers ? { headers } : { actor: owner }),
        payload: { title },
      })
    ).json().issue as { id: string };
  const edit = (issueId: string, headers: Record<string, string> | null, payload: object) =>
    request(`/workspaces/${workspace.id}/issues/${issueId}`, {
      method: 'PATCH',
      ...(headers ? { headers } : { actor: owner }),
      payload,
    });
  return { owner, workspace, agentId: agent.id as string, bot, issueBy, edit };
}

async function judged() {
  const { workerDb, ownerDb } = await getHarness();
  await judgeAgentChanges(workerDb, inEightDays());
  return ownerDb
    .select({
      field: agentChanges.field,
      entityType: agentChanges.entityType,
      outcome: agentChanges.outcome,
    })
    .from(agentChanges);
}

describe('what a change came to', () => {
  test('is decided from the value before, after and now', () => {
    const change = { field: 'status', before: '"TODO"', after: '"IN_PROGRESS"' };
    expect(outcomeOfChange(change, { status: 'IN_PROGRESS' })).toBe('kept');
    expect(outcomeOfChange(change, { status: 'TODO' })).toBe('reverted');
    expect(outcomeOfChange(change, { status: 'DONE' })).toBe('edited');
    expect(outcomeOfChange(change, null)).toBe('reverted');
    expect(outcomeOfChange({ field: 'created', before: null, after: null }, { id: 'x' })).toBe(
      'kept',
    );
  });
});

describe('an agent’s edit', () => {
  test('that a person reverts shows as reverted', async () => {
    const { bot, issueBy, edit } = await setUp();
    const issue = await issueBy(null, 'Move me');
    await edit(issue.id, bot, { status: 'IN_PROGRESS' });
    await edit(issue.id, null, { status: 'TODO' });

    expect(await judged()).toEqual([{ field: 'status', entityType: 'issue', outcome: 'reverted' }]);
  });

  test('that a person leaves alone is kept, and one they change again is edited', async () => {
    const { bot, issueBy, edit } = await setUp();
    const kept = await issueBy(null, 'Leave me');
    const changed = await issueBy(null, 'Change me');
    await edit(kept.id, bot, { priority: 'HIGH' });
    await edit(changed.id, bot, { title: 'Bot title' });
    await edit(changed.id, null, { title: 'A person’s title' });

    const outcomes = (await judged()).map((c) => `${c.field}:${c.outcome}`).sort();
    expect(outcomes).toEqual(['priority:kept', 'title:edited']);
  });

  test('is not judged before it is seven days old', async () => {
    const { bot, issueBy, edit } = await setUp();
    const issue = await issueBy(null, 'Too soon');
    await edit(issue.id, bot, { status: 'DONE' });
    const { workerDb, ownerDb } = await getHarness();
    expect(await judgeAgentChanges(workerDb, new Date(Date.now() + 6 * DAY_MS))).toBe(0);
    const [row] = await ownerDb.select().from(agentChanges);
    expect(row?.outcome).toBeNull();
  });
});

describe('what an agent made', () => {
  test('an issue a person deletes is reverted; one they keep is kept', async () => {
    const { owner, workspace, bot, issueBy } = await setUp();
    const deleted = await issueBy(bot, 'Spam from a bot');
    await issueBy(bot, 'Useful from a bot');
    await request(`/workspaces/${workspace.id}/issues/${deleted.id}`, {
      method: 'DELETE',
      actor: owner,
    });

    const outcomes = (await judged()).map((c) => c.outcome).sort();
    expect(outcomes).toEqual(['kept', 'reverted']);
  });

  test('a comment an admin removes is reverted', async () => {
    const { owner, workspace, bot, issueBy } = await setUp();
    const issue = await issueBy(null, 'Discuss');
    const comment = (
      await request(`/workspaces/${workspace.id}/issues/${issue.id}/comments`, {
        method: 'POST',
        headers: bot,
        payload: { body: 'Off topic' },
      })
    ).json().comment;
    await request(`/workspaces/${workspace.id}/comments/${comment.id}`, {
      method: 'DELETE',
      actor: owner,
    });

    expect(await judged()).toEqual([
      { field: 'created', entityType: 'comment', outcome: 'reverted' },
    ]);
  });

  test('a person’s own changes are not recorded', async () => {
    const { issueBy, edit } = await setUp();
    const issue = await issueBy(null, 'Mine');
    await edit(issue.id, null, { status: 'DONE' });
    const { ownerDb } = await getHarness();
    expect(await ownerDb.select().from(agentChanges)).toEqual([]);
  });
});

describe('history', () => {
  test('runs and their steps go after 90 days, with judgements as old', async () => {
    const { workspace, agentId } = await setUp();
    const { ownerDb, workerDb } = await getHarness();
    const old = new Date(Date.now() - 91 * DAY_MS);
    const [run] = await ownerDb
      .insert(agentRuns)
      .values({
        workspaceId: workspace.id,
        agentId,
        source: 'calls',
        startedAt: old,
        lastStepAt: old,
      })
      .returning();
    await ownerDb.insert(agentSteps).values({
      runId: run!.id,
      workspaceId: workspace.id,
      tool: 'search',
      outcome: 'ok',
      status: 200,
      durationMs: 3,
      at: old,
    });
    await ownerDb.insert(agentChanges).values({
      workspaceId: workspace.id,
      agentId,
      entityType: 'issue',
      entityId: workspace.id,
      field: 'status',
      at: old,
      outcome: 'kept',
      judgedAt: old,
    });

    await pruneAgentHistory(workerDb);
    expect(await ownerDb.select().from(agentRuns)).toEqual([]);
    expect(await ownerDb.select().from(agentSteps)).toEqual([]);
    expect(
      await ownerDb.select().from(agentChanges).where(eq(agentChanges.agentId, agentId)),
    ).toEqual([]);
  });
});
