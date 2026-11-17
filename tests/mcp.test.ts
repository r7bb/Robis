import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { comments, issues } from '@robis/database';
import { createMcpHandler, MAX_BODY_BYTES } from '@robis/mcp/server.ts';
import { TOOL_NAMES } from '@robis/mcp/tools.ts';
import { eq } from 'drizzle-orm';
import {
  type Actor,
  addMember,
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  getHarness,
  request,
  resetDatabase,
} from './harness.ts';
import { mcpHandler as handler, mcpFetch, observed } from './mcp-harness.ts';

/**
 * The MCP server (B5, slice 3), driven by the SDK's own client. The server
 * calls the API as the agent, so a denied tool call carries the same status
 * and code a person would get, a retried write with the same key happens
 * once, and a revoked token is refused on the very next call.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

async function connect(workspaceId: string, secret: string) {
  const client = new Client({ name: 'test-agent', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://mcp.internal/mcp/${workspaceId}`),
    {
      requestInit: { headers: { authorization: `Bearer ${secret}` } },
      fetch: mcpFetch,
    },
  );
  await client.connect(transport);
  return client;
}

type ToolAnswer = { isError?: boolean; content: { type: string; text: string }[] };
const parsed = (answer: unknown) => JSON.parse((answer as ToolAnswer).content[0]!.text);

async function setUp(role: 'MEMBER' | 'GUEST' = 'MEMBER') {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const project = await createProject(owner, workspace.id);
  const created = await request(`/workspaces/${workspace.id}/agents`, {
    method: 'POST',
    actor: owner,
    payload: { name: 'Triage bot', role },
  });
  const { agent, token } = created.json();
  return { owner, workspace, project, agentId: agent.id as string, token };
}

describe('the MCP server', () => {
  test('offers its fixed list of tools', async () => {
    const { workspace, token } = await setUp();
    const client = await connect(workspace.id, token.secret);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    await client.close();
  });

  test('files an issue, reads it, edits it and comments, all as the agent', async () => {
    const { workspace, project, agentId, token } = await setUp();
    const client = await connect(workspace.id, token.secret);

    const created = parsed(
      await client.callTool({
        name: 'create_issue',
        arguments: {
          projectId: project.id,
          title: 'Login fails on Safari',
          idempotencyKey: 'mcp-create-1',
        },
      }),
    );
    expect(created.issue).toMatchObject({ createdBy: agentId, delegateId: agentId });

    const edited = parsed(
      await client.callTool({
        name: 'update_issue',
        arguments: {
          issueId: created.issue.id,
          status: 'IN_PROGRESS',
          idempotencyKey: 'mcp-edit-1',
        },
      }),
    );
    expect(edited.issue.status).toBe('IN_PROGRESS');

    await client.callTool({
      name: 'comment',
      arguments: {
        issueId: created.issue.id,
        body: 'Seen on 17.1',
        idempotencyKey: 'mcp-comment-1',
      },
    });
    const read = parsed(
      await client.callTool({ name: 'read_issue', arguments: { issueId: created.issue.id } }),
    );
    expect(read.issue.title).toBe('Login fails on Safari');
    expect(read.comments.map((c: { body: string }) => c.body)).toEqual(['Seen on 17.1']);

    const found = parsed(await client.callTool({ name: 'search', arguments: { query: 'Safari' } }));
    expect(found.results.map((r: { id: string }) => r.id)).toContain(created.issue.id);
    await client.close();
  });

  test('a retried write with the same key happens once', async () => {
    const { workspace, project, token } = await setUp();
    const client = await connect(workspace.id, token.secret);
    const call = () =>
      client.callTool({
        name: 'create_issue',
        arguments: { projectId: project.id, title: 'Once only', idempotencyKey: 'mcp-retry-1' },
      });

    const first = parsed(await call());
    const second = parsed(await call());
    expect(second.issue.id).toBe(first.issue.id);
    const issueId = first.issue.id as string;
    const comment = () =>
      client.callTool({
        name: 'comment',
        arguments: { issueId, body: 'Once', idempotencyKey: 'mcp-retry-comment' },
      });
    await comment();
    await comment();

    const { ownerDb } = await getHarness();
    expect(
      await ownerDb.select().from(issues).where(eq(issues.workspaceId, workspace.id)),
    ).toHaveLength(1);
    expect(await ownerDb.select().from(comments).where(eq(comments.issueId, issueId))).toHaveLength(
      1,
    );
    await client.close();
  });

  test('a denied call carries the same status and code a person with that role gets', async () => {
    const { owner, workspace, project, token } = await setUp('GUEST');
    const guest: Actor = await createActor('Guest');
    await addMember(owner, workspace.id, guest, 'GUEST');
    const client = await connect(workspace.id, token.secret);

    const byAgent = await client.callTool({
      name: 'create_issue',
      arguments: {
        projectId: project.id,
        title: 'Not mine to file',
        idempotencyKey: 'mcp-denied-1',
      },
    });
    const byPerson = await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      method: 'POST',
      actor: guest,
      payload: { title: 'Not mine to file' },
    });

    expect((byAgent as ToolAnswer).isError).toBe(true);
    expect(parsed(byAgent)).toEqual({ status: byPerson.statusCode, ...byPerson.json() });
    expect(byPerson.statusCode).toBe(403);
    await client.close();
  });

  test('another workspace is answered as a stranger is: 404', async () => {
    const { token } = await setUp();
    const other = await createActor('Other');
    const elsewhere = await createWorkspace(other, 'Elsewhere');
    const client = await connect(elsewhere.id, token.secret);

    const answer = await client.callTool({ name: 'list_projects', arguments: {} });
    expect((answer as ToolAnswer).isError).toBe(true);
    expect(parsed(answer).status).toBe(404);
    await client.close();
  });

  test('a revoked token is refused on the very next call', async () => {
    const { owner, workspace, agentId, token } = await setUp();
    const client = await connect(workspace.id, token.secret);
    expect((await client.callTool({ name: 'list_projects', arguments: {} })).isError).toBeFalsy();

    await request(`/workspaces/${workspace.id}/agents/${agentId}/tokens/${token.id}`, {
      method: 'DELETE',
      actor: owner,
    });
    const after = await client.callTool({ name: 'list_projects', arguments: {} });
    expect((after as ToolAnswer).isError).toBe(true);
    expect(parsed(after).status).toBe(401);
    await client.close();
  });

  test('without a token there is no session to start', async () => {
    const { workspace } = await setUp();
    const response = await handler(
      new Request(`http://mcp.internal/mcp/${workspace.id}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });

  test('records each tool call’s outcome for its metrics', async () => {
    observed.length = 0;
    const { workspace, token } = await setUp();
    const client = await connect(workspace.id, token.secret);
    await client.callTool({ name: 'list_projects', arguments: {} });
    expect(observed).toEqual([{ name: 'list_projects', outcome: 'ok' }]);
    await client.close();
  });
});

describe('what the review asked for', () => {
  const rpc = (path: string, headers: Record<string, string> = {}, body = '{}') =>
    handler(
      new Request(`http://mcp.internal${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...headers,
        },
        body,
      }),
    );
  const workspace = '00000000-0000-4000-8000-000000000001';
  const wellFormed = `rba_${'a'.repeat(43)}`;

  test('a request from a web page is refused: MCP clients are programs', async () => {
    const response = await rpc(`/mcp/${workspace}`, {
      authorization: `Bearer ${wellFormed}`,
      origin: 'https://evil.example',
    });
    expect(response.status).toBe(403);
  });

  test('a body over the limit is refused before it is read', async () => {
    const response = await rpc(`/mcp/${workspace}`, {
      authorization: `Bearer ${wellFormed}`,
      'content-length': String(MAX_BODY_BYTES + 1),
    });
    expect(response.status).toBe(413);
  });

  test('a token of the wrong shape is refused before any server is made', async () => {
    const response = await rpc(`/mcp/${workspace}`, { authorization: 'Bearer not-a-token' });
    expect(response.status).toBe(401);
  });

  test('a broken path is a 404, not a crash', async () => {
    expect((await rpc('/mcp/%zz', { authorization: `Bearer ${wellFormed}` })).status).toBe(404);
  });

  test('an unexpected failure reaches the agent as an internal error, never its details', async () => {
    const { workspace: real, token } = await setUp();
    const broken = createMcpHandler({
      apiUrl: 'http://api.internal',
      fetcher: (async () => {
        throw new Error('connect ECONNREFUSED http://api:4000');
      }) as unknown as typeof fetch,
    });
    const client = new Client({ name: 'test-agent', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://mcp.internal/mcp/${real.id}`), {
        requestInit: { headers: { authorization: `Bearer ${token.secret}` } },
        fetch: ((input: string | URL | Request, init?: RequestInit) =>
          broken(new Request(input, init))) as typeof fetch,
      }),
    );

    const answer = await client.callTool({ name: 'list_projects', arguments: {} });
    expect((answer as ToolAnswer).isError).toBe(true);
    expect(parsed(answer)).toEqual({ status: 500, error: 'internal' });
    expect(JSON.stringify(answer)).not.toContain('api:4000');
    await client.close();
  });
});
