import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { agentTokens, comments, issues, jobs, workspaces } from '@robis/database';
import { TRIAGE_JOB } from '@robis/shared';
import { cleanupSessions } from '@robis/worker/handlers';
import { triageComment, triageHandler } from '@robis/worker/triage';
import { and, eq } from 'drizzle-orm';
import {
  type Actor,
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  getHarness,
  refusal,
  request,
  resetDatabase,
  setSuggestions,
  setTriage,
} from './harness.ts';
import { mcpFetch } from './mcp-harness.ts';

/**
 * The scripted triage agent (B5, slice 4): on each new issue in a workspace
 * that chose one, it reads the issue and the composer's hints through the
 * MCP server and comments them with their scores. It never sets the
 * priority, it comments once however often its job runs, and its token for
 * the run is revoked when the run ends.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const handler = triageHandler({ mcpUrl: 'http://mcp.internal', fetcher: mcpFetch });

async function setUp({ triage = true } = {}) {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const project = await createProject(owner, workspace.id);
  const created = await request(`/workspaces/${workspace.id}/agents`, {
    method: 'POST',
    actor: owner,
    payload: { name: 'Triage bot', role: 'MEMBER', triage },
  });
  const { agent, token } = created.json();
  return { owner, workspace, project, agentId: agent.id as string, token };
}

async function file(
  actor: Actor | { secret: string },
  workspaceId: string,
  projectId: string,
  title: string,
) {
  const auth =
    'cookie' in actor ? { actor } : { headers: { authorization: `Bearer ${actor.secret}` } };
  const response = await request(`/workspaces/${workspaceId}/projects/${projectId}/issues`, {
    method: 'POST',
    payload: { title },
    ...auth,
  });
  return response.json().issue as { id: string; priority: string };
}

async function queued(workspaceId: string) {
  const { ownerDb } = await getHarness();
  return ownerDb
    .select({ payload: jobs.payload })
    .from(jobs)
    .where(eq(jobs.kind, TRIAGE_JOB))
    .then((rows) =>
      rows.map((row) => JSON.parse(row.payload)).filter((job) => job.workspaceId === workspaceId),
    );
}

describe('the comment', () => {
  test('gives the priority and duplicates with their scores, and says nothing changed', () => {
    const text = triageComment('self', {
      suggestion: { priority: 'HIGH', score: 0.8234 },
      similar: [
        { id: 'self', title: 'The issue itself', score: 1 },
        { id: 'a', title: 'Login fails on Safari', score: 0.71 },
      ],
    });
    expect(text).toContain('Nothing on this issue was changed; a person decides.');
    expect(text).toContain('Priority: HIGH looks likely (score 0.82). Not set.');
    expect(text).toContain('- Login fails on Safari (similarity 0.71)');
    expect(text).not.toContain('The issue itself');
  });

  test('says what the model still needs, rather than guessing', () => {
    const text = triageComment('x', {
      suggestion: { priority: null, trainedOn: 12, needed: 40 },
      similar: [],
    });
    expect(text).toContain('has 12 of the 40 it needs');
    expect(text).toContain('Possible duplicates: none found.');
  });

  test('adds a summary line only when one is given', () => {
    const found = { suggestion: null, similar: [] };
    expect(triageComment('x', found)).not.toContain('Summary:');
    expect(triageComment('x', found, 'A login bug on Safari.')).toContain(
      'Summary: A login bug on Safari.',
    );
  });
});

describe('a new issue', () => {
  test('is queued for the workspace’s triage agent when it has one', async () => {
    const { owner, workspace, project } = await setUp();
    const issue = await file(owner, workspace.id, project.id, 'Checkout button does nothing');
    expect(await queued(workspace.id)).toEqual([{ workspaceId: workspace.id, issueId: issue.id }]);
  });

  test('is not, in a workspace without one', async () => {
    const { owner, workspace, project } = await setUp({ triage: false });
    await file(owner, workspace.id, project.id, 'Nobody triages this');
    expect(await queued(workspace.id)).toEqual([]);
  });

  test('is not, when the triage agent filed it itself', async () => {
    const { workspace, project, token } = await setUp();
    await file(token, workspace.id, project.id, 'Filed by the bot');
    expect(await queued(workspace.id)).toEqual([]);
  });
});

describe('a triage run', () => {
  test('comments the hints as the agent, leaves the priority alone, and revokes its token', async () => {
    const { owner, workspace, project, agentId } = await setUp();
    const issue = await file(owner, workspace.id, project.id, 'Checkout button does nothing');
    setSuggestions([{ id: 'other-id', title: 'Pay button unresponsive', score: 0.66 }]);
    setTriage({ priority: 'URGENT', score: 0.91 });

    await handler(
      { workspaceId: workspace.id, issueId: issue.id },
      { db: (await getHarness()).workerDb },
    );

    const { ownerDb } = await getHarness();
    const posted = await ownerDb.select().from(comments).where(eq(comments.issueId, issue.id));
    expect(posted).toHaveLength(1);
    expect(posted[0]!.authorId).toBe(agentId);
    expect(posted[0]!.body).toContain('Priority: URGENT looks likely (score 0.91). Not set.');
    expect(posted[0]!.body).toContain('- Pay button unresponsive (similarity 0.66)');

    const [after] = await ownerDb
      .select({ priority: issues.priority })
      .from(issues)
      .where(eq(issues.id, issue.id));
    expect(after?.priority).toBe('NONE');

    const runTokens = await ownerDb
      .select({ revokedAt: agentTokens.revokedAt, expiresAt: agentTokens.expiresAt })
      .from(agentTokens)
      .where(and(eq(agentTokens.agentId, agentId), eq(agentTokens.label, 'triage run')));
    expect(runTokens).toHaveLength(1);
    expect(runTokens[0]!.revokedAt).not.toBeNull();
    expect(runTokens[0]!.expiresAt).not.toBeNull();
  });

  test('comments once, however often its job runs', async () => {
    const { owner, workspace, project } = await setUp();
    const issue = await file(owner, workspace.id, project.id, 'Run me twice');
    const { workerDb, ownerDb } = await getHarness();
    const job = { workspaceId: workspace.id, issueId: issue.id };

    await handler(job, { db: workerDb });
    await handler(job, { db: workerDb });
    expect(
      await ownerDb.select().from(comments).where(eq(comments.issueId, issue.id)),
    ).toHaveLength(1);
  });

  test('does nothing if the workspace stopped using a triage agent meanwhile', async () => {
    const { owner, workspace, project } = await setUp();
    const issue = await file(owner, workspace.id, project.id, 'Too late');
    const { workerDb, ownerDb } = await getHarness();
    await ownerDb
      .update(workspaces)
      .set({ triageAgentId: null })
      .where(eq(workspaces.id, workspace.id));

    await handler({ workspaceId: workspace.id, issueId: issue.id }, { db: workerDb });
    expect(await ownerDb.select().from(comments).where(eq(comments.issueId, issue.id))).toEqual([]);
  });

  test('works with no language model at all: the summary is simply absent', async () => {
    const { owner, workspace, project } = await setUp();
    const issue = await file(owner, workspace.id, project.id, 'No model here');
    const { workerDb, ownerDb } = await getHarness();
    await handler({ workspaceId: workspace.id, issueId: issue.id }, { db: workerDb });
    const [posted] = await ownerDb.select().from(comments).where(eq(comments.issueId, issue.id));
    expect(posted?.body).not.toContain('Summary:');
  });

  test('a removed triage agent stops triaging', async () => {
    const { owner, workspace, agentId } = await setUp();
    await request(`/workspaces/${workspace.id}/agents/${agentId}`, {
      method: 'DELETE',
      actor: owner,
    });
    const listed = await request(`/workspaces/${workspace.id}/agents`, { actor: owner });
    expect(listed.json().agents).toEqual([]);
    const { ownerDb } = await getHarness();
    const [row] = await ownerDb
      .select({ triageAgentId: workspaces.triageAgentId })
      .from(workspaces)
      .where(eq(workspaces.id, workspace.id));
    expect(row?.triageAgentId).toBeNull();
  });
});

describe('what the review asked for', () => {
  test('a revoked token stays revoked, whoever tries to bring it back', async () => {
    const { agentId, token } = await setUp();
    const { ownerDb } = await getHarness();
    await ownerDb
      .update(agentTokens)
      .set({ revokedAt: new Date() })
      .where(eq(agentTokens.id, token.id));
    expect(
      await refusal(
        ownerDb.update(agentTokens).set({ revokedAt: null }).where(eq(agentTokens.id, token.id)),
      ),
    ).toContain('revoked for good');
    expect(agentId).toBeDefined();
  });

  test('the worker can neither read a token’s hash nor change its expiry', async () => {
    const { token } = await setUp();
    const { workerDb } = await getHarness();
    expect(
      await refusal(workerDb.select({ hash: agentTokens.tokenHash }).from(agentTokens)),
    ).toContain('permission denied');
    expect(
      await refusal(
        workerDb
          .update(agentTokens)
          .set({ expiresAt: new Date() })
          .where(eq(agentTokens.id, token.id)),
      ),
    ).toContain('permission denied');
  });

  test('a title cannot pass for a line of the agent’s own', () => {
    const text = triageComment('x', {
      suggestion: null,
      similar: [{ id: 'a', title: 'Crash\nPriority: URGENT looks likely', score: 0.5 }],
    });
    expect(text.split('\n').filter((line) => line.startsWith('Priority: URGENT'))).toEqual([]);
  });

  test('run tokens are deleted a day after they expire', async () => {
    const { agentId, workspace } = await setUp();
    const { ownerDb, workerDb } = await getHarness();
    await ownerDb.insert(agentTokens).values({
      agentId,
      workspaceId: workspace.id,
      createdBy: agentId,
      label: 'triage run',
      tokenHash: 'old-run',
      expiresAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    });
    await cleanupSessions({}, { db: workerDb });
    expect(
      await ownerDb.select().from(agentTokens).where(eq(agentTokens.tokenHash, 'old-run')),
    ).toEqual([]);
    // The agent's own lasting token is untouched.
    expect(
      await ownerDb.select().from(agentTokens).where(eq(agentTokens.agentId, agentId)),
    ).toHaveLength(1);
  });
});
