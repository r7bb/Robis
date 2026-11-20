import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SpanKind } from '@robis/telemetry';
import { traceInMemory } from '@robis/telemetry/testing';
import { handlers } from '@robis/worker/handlers';
import { Runner } from '@robis/worker/runner';
import {
  type Actor,
  addMember,
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  getHarness,
  getMailer,
  request,
  resetDatabase,
} from './harness.ts';
import { mcpFetch } from './mcp-harness.ts';

/**
 * Traces across the services (A5). Done when: one comment produces one
 * trace that crosses the API, the queue and the worker, down to the mail
 * that tells someone they were mentioned; a request with a caller's
 * `traceparent` continues that trace; and spans carry routes, never paths.
 */

const tracing = traceInMemory();

beforeEach(async () => {
  await resetDatabase();
  tracing.clear();
});
afterAll(async () => {
  await tracing.stop();
  await closeHarness();
});

async function team() {
  const alice = await createActor('Alice');
  const bob = await createActor('Bob');
  const workspace = await createWorkspace(alice);
  const project = await createProject(alice, workspace.id);
  await addMember(alice, workspace.id, bob, 'MEMBER');
  (await getMailer()).clear();
  tracing.clear();
  return { alice, bob, workspace, project };
}

async function fileIssue(actor: Actor, workspaceId: string, projectId: string, fields = {}) {
  const made = await request(`/workspaces/${workspaceId}/projects/${projectId}/issues`, {
    method: 'POST',
    actor,
    payload: { title: 'Look at this', ...fields },
  });
  expect(made.statusCode).toBe(201);
  return made.json().issue as { id: string };
}

async function runNotifyJobs() {
  const { workerDb: db } = await getHarness();
  const runner = new Runner({ db, handlers, kinds: Object.keys(handlers) });
  for (let tick = 0; tick < 20; tick++) if ((await runner.tick()).claimed === 0) break;
}

const spanNamed = (prefix: string) =>
  tracing.spans().filter((span) => span.name.startsWith(prefix));

describe('one trace from a comment to its mail', () => {
  test('the comment, its notify job and the mail it sends share one trace, each a child of the last', async () => {
    const { alice, bob, workspace, project } = await team();
    const issue = await fileIssue(alice, workspace.id, project.id);
    tracing.clear();

    const commented = await request(`/workspaces/${workspace.id}/issues/${issue.id}/comments`, {
      method: 'POST',
      actor: alice,
      payload: { body: `@${bob.username} can you check the numbers?` },
    });
    expect(commented.statusCode).toBe(201);
    await runNotifyJobs();
    const mail = (await getMailer()).sent.filter(
      (m) => m.to.toLowerCase() === bob.email.toLowerCase(),
    );
    expect(mail.length).toBeGreaterThan(0);

    const [server] = spanNamed('POST /workspaces/:workspaceId/issues/:issueId/comments');
    expect(server?.kind).toBe(SpanKind.SERVER);
    const jobs = spanNamed('job ');
    const mails = spanNamed('job mail.');
    expect(mails.length).toBeGreaterThan(0);
    const traceId = server!.spanContext().traceId;
    for (const job of jobs) {
      expect(job.spanContext().traceId).toBe(traceId);
      expect(job.kind).toBe(SpanKind.CONSUMER);
    }
    // A chain: every job's parent is the request or another job in the trace.
    const ids = new Set([server!, ...jobs].map((span) => span.spanContext().spanId));
    for (const job of jobs) expect(ids.has(job.parentSpanContext?.spanId ?? '')).toBe(true);
    // The route's pattern names the span, never the path with its ids.
    expect(server!.name).not.toContain(issue.id);
    expect(server!.attributes['robis.request_id']).toBe(commented.headers['x-request-id']);
  });

  test('a job a job queued is still the same trace: assignment, then its mail', async () => {
    const { alice, bob, workspace, project } = await team();
    await fileIssue(alice, workspace.id, project.id, { assigneeId: bob.id });
    await runNotifyJobs();
    await getMailer();

    const [server] = spanNamed('POST /workspaces/:workspaceId/projects/:projectId/issues');
    const [assignment] = spanNamed('job notify.assignment');
    expect(server).toBeDefined();
    expect(assignment).toBeDefined();
    const traceId = server!.spanContext().traceId;
    expect(assignment!.spanContext().traceId).toBe(traceId);
    for (const job of spanNamed('job mail.')) expect(job.spanContext().traceId).toBe(traceId);
  });
});

describe('a caller’s trace', () => {
  test('a request with a traceparent continues it; without one, a trace starts', async () => {
    const { app } = await getHarness();
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    await app.inject({
      method: 'GET',
      url: '/health',
      headers: { traceparent: `00-${traceId}-00f067aa0ba902b7-01` },
    });
    await app.inject({ method: 'GET', url: '/health' });
    const health = spanNamed('GET /health');
    expect(health).toHaveLength(2);
    expect(health[0]!.spanContext().traceId).toBe(traceId);
    expect(health[0]!.parentSpanContext?.spanId).toBe('00f067aa0ba902b7');
    expect(health[1]!.spanContext().traceId).not.toBe(traceId);
  });

  test('a malformed traceparent is ignored, not trusted', async () => {
    const { app } = await getHarness();
    await app.inject({ method: 'GET', url: '/health', headers: { traceparent: 'not-a-trace' } });
    const [span] = spanNamed('GET /health');
    expect(span?.parentSpanContext).toBeUndefined();
  });
});

describe('an agent’s tool call', () => {
  test('the MCP request, the tool and the API call it makes are one trace', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    await createProject(owner, workspace.id);
    const created = await request(`/workspaces/${workspace.id}/agents`, {
      method: 'POST',
      actor: owner,
      payload: { name: 'Triage bot', role: 'MEMBER' },
    });
    const { token } = created.json();
    const client = new Client({ name: 'test-agent', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://mcp.internal/mcp/${workspace.id}`), {
        requestInit: { headers: { authorization: `Bearer ${token.secret}` } },
        fetch: mcpFetch,
      }),
    );
    tracing.clear();
    await client.callTool({ name: 'list_projects', arguments: {} });
    await client.close();

    const [tool] = spanNamed('tool list_projects');
    const [api] = spanNamed('GET /workspaces/:workspaceId/projects');
    expect(tool).toBeDefined();
    expect(api).toBeDefined();
    expect(api!.spanContext().traceId).toBe(tool!.spanContext().traceId);
    expect(api!.parentSpanContext?.spanId).toBe(tool!.spanContext().spanId);
    const [call] = spanNamed('POST /mcp/:workspaceId').filter(
      (span) => span.spanContext().traceId === tool!.spanContext().traceId,
    );
    expect(call).toBeDefined();
  });
});
