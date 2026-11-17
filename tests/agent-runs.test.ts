import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { agentRuns, agentSteps, RUN_IDLE_MS, recordAgentStep } from '@robis/database';
import { triageHandler } from '@robis/worker/triage';
import { asc, eq } from 'drizzle-orm';
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
import { mcpFetch } from './mcp-harness.ts';

/**
 * Runs and steps (B6, slice 2): each call an agent makes in its workspace is
 * recorded once answered, as a step of a run, with the tool, the outcome and
 * the time it took, and never what was sent.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

async function setUp(role: 'MEMBER' | 'GUEST' = 'MEMBER', triage = false) {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const project = await createProject(owner, workspace.id);
  const created = await request(`/workspaces/${workspace.id}/agents`, {
    method: 'POST',
    actor: owner,
    payload: { name: 'Watched bot', role, triage },
  });
  const { agent, token } = created.json();
  return { owner, workspace, project, agentId: agent.id as string, secret: token.secret as string };
}

/** Steps are written after the answer goes out: wait for them. */
async function stepsIn(workspaceId: string, count: number) {
  const { ownerDb } = await getHarness();
  for (let i = 0; i < 50; i++) {
    const rows = await ownerDb
      .select()
      .from(agentSteps)
      .where(eq(agentSteps.workspaceId, workspaceId))
      .orderBy(asc(agentSteps.id));
    if (rows.length >= count) return rows;
    await Bun.sleep(20);
  }
  throw new Error(`expected ${count} steps in ${workspaceId}`);
}

describe('a call made to the API directly', () => {
  test('is a step named by its route, with its outcome and time', async () => {
    const { workspace, secret } = await setUp();
    await request(`/workspaces/${workspace.id}/projects`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    const [step] = await stepsIn(workspace.id, 1);
    expect(step).toMatchObject({
      tool: 'api:/workspaces/:workspaceId/projects',
      outcome: 'ok',
      status: 200,
    });
    expect(step!.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('a refusal is a denied step', async () => {
    const { workspace, project, secret } = await setUp('GUEST');
    await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
      payload: { title: 'Not allowed' },
    });
    const [step] = await stepsIn(workspace.id, 1);
    expect(step).toMatchObject({ outcome: 'denied', status: 403 });
  });

  test('a call into another workspace is not recorded there', async () => {
    const { secret } = await setUp();
    const other = await createActor('Other');
    const elsewhere = await createWorkspace(other, 'Elsewhere');
    await request(`/workspaces/${elsewhere.id}/projects`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    await Bun.sleep(150);
    const { ownerDb } = await getHarness();
    expect(
      await ownerDb.select().from(agentSteps).where(eq(agentSteps.workspaceId, elsewhere.id)),
    ).toEqual([]);
  });

  test('a person’s call is not a step', async () => {
    const { owner, workspace } = await setUp();
    const member = await createActor('Member');
    await addMember(owner, workspace.id, member, 'MEMBER');
    await request(`/workspaces/${workspace.id}/projects`, { actor: member });
    await Bun.sleep(150);
    const { ownerDb } = await getHarness();
    expect(
      await ownerDb.select().from(agentSteps).where(eq(agentSteps.workspaceId, workspace.id)),
    ).toEqual([]);
  });
});

describe('through the MCP server', () => {
  test('steps are named by tool, and calls close together are one run', async () => {
    const { workspace, secret } = await setUp();
    const client = new Client({ name: 'watched', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://mcp.internal/mcp/${workspace.id}`), {
        requestInit: { headers: { authorization: `Bearer ${secret}` } },
        fetch: mcpFetch,
      }),
    );
    await client.callTool({ name: 'list_projects', arguments: {} });
    await client.callTool({ name: 'search', arguments: { query: 'anything' } });
    await client.close();

    const steps = await stepsIn(workspace.id, 2);
    expect(steps.map((s) => s.tool)).toEqual(['list_projects', 'search']);
    expect(new Set(steps.map((s) => s.runId)).size).toBe(1);
    const { ownerDb } = await getHarness();
    const [run] = await ownerDb.select().from(agentRuns).where(eq(agentRuns.id, steps[0]!.runId));
    expect(run).toMatchObject({ source: 'calls' });
  });

  test('a run id the client sends groups its calls', async () => {
    const { workspace, secret } = await setUp();
    const call = (run: string) =>
      request(`/workspaces/${workspace.id}/projects`, {
        headers: { authorization: `Bearer ${secret}`, 'x-robis-run': run },
      });
    await call('job-1');
    await call('job-2');
    const steps = await stepsIn(workspace.id, 2);
    expect(new Set(steps.map((s) => s.runId)).size).toBe(2);
    const { ownerDb } = await getHarness();
    const keys = (await ownerDb.select({ key: agentRuns.runKey }).from(agentRuns)).map(
      (r) => r.key,
    );
    expect(keys.sort()).toEqual(['run:job-1', 'run:job-2']);
  });

  test('a run id cannot pass for a triage run’s token', async () => {
    const { workspace, secret } = await setUp();
    await request(`/workspaces/${workspace.id}/projects`, {
      headers: { authorization: `Bearer ${secret}`, 'x-robis-run': 'token:anything' },
    });
    await stepsIn(workspace.id, 1);
    const { ownerDb } = await getHarness();
    const [run] = await ownerDb
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.workspaceId, workspace.id));
    expect(run).toMatchObject({ source: 'calls', runKey: 'run:token:anything' });
  });
});

describe('runs', () => {
  test('a quiet spell longer than the idle limit starts a new run', async () => {
    const { workspace, agentId } = await setUp();
    const { ownerDb } = await getHarness();
    const step = {
      workspaceId: workspace.id,
      agentId,
      runKey: null,
      source: 'calls' as const,
      tool: 'search',
      outcome: 'ok' as const,
      status: 200,
      durationMs: 5,
    };
    const start = new Date('2026-11-17T09:00:00Z');
    const first = await recordAgentStep(ownerDb, step, start);
    const soon = await recordAgentStep(ownerDb, step, new Date(start.getTime() + 60_000));
    const later = await recordAgentStep(
      ownerDb,
      step,
      new Date(start.getTime() + 60_000 + RUN_IDLE_MS + 1),
    );
    expect(soon).toBe(first);
    expect(later).not.toBe(first);
  });

  test('each triage run is a run of its own, marked as triage', async () => {
    const { owner, workspace, project } = await setUp('MEMBER', true);
    const handler = triageHandler({ mcpUrl: 'http://mcp.internal', fetcher: mcpFetch });
    const { workerDb, ownerDb } = await getHarness();
    for (const title of ['One', 'Two']) {
      const issue = (
        await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
          method: 'POST',
          actor: owner,
          payload: { title },
        })
      ).json().issue;
      await handler({ workspaceId: workspace.id, issueId: issue.id }, { db: workerDb });
    }
    // read_issue is two calls (the issue, its comments), then suggest and comment.
    await stepsIn(workspace.id, 8);
    const runs = await ownerDb
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.workspaceId, workspace.id));
    expect(runs.map((r) => r.source)).toEqual(['triage', 'triage']);
    const steps = await stepsIn(workspace.id, 8);
    const perRun = runs.map((run) => steps.filter((s) => s.runId === run.id).length);
    expect(perRun).toEqual([4, 4]);
  });
});
