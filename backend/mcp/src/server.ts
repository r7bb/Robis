import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { isUuid } from '@robis/shared';
import { contextFrom, inSpan, SpanKind } from '@robis/telemetry';
import { ApiClient } from './api-client.ts';
import { createToolServer, type ToolName, type ToolOutcome } from './tools.ts';

/**
 * The MCP endpoint (B5): `POST /mcp/<workspace id>` with the agent's token
 * as `Authorization: Bearer`.
 *
 * Stateless: each request gets its own server and transport, answers in
 * plain JSON, and keeps nothing, so any instance can take any call and a
 * revoked token is refused on its very next one (the API checks it every
 * time). The server never decides who may do what; the API does.
 */

const PATH = /^\/mcp\/([^/]+)\/?$/;

/** The largest request taken: a tool's biggest input is about 10 KB. */
export const MAX_BODY_BYTES = 64 * 1024;

/** An agent token's shape (see `@robis/auth`): anything else is refused here. */
const AGENT_TOKEN = /^rba_[A-Za-z0-9_-]{43}$/;
/** A run id a caller may send: short and plain, or it is ignored. */
const RUN_KEY = /^[A-Za-z0-9_.:-]{1,100}$/;

export type McpOptions = {
  /** Where the API answers, from inside the stack. */
  apiUrl: string;
  fetcher?: typeof fetch;
  observe?: (name: ToolName, outcome: ToolOutcome, ms: number) => void;
};

function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function bearer(request: Request): string | null {
  const [scheme, token] = (request.headers.get('authorization') ?? '').split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });

/**
 * Everything checked before a server is made: the path names a workspace,
 * the request is a POST from a program (not a page), it is not too large,
 * and it carries a token of the right shape. A refusal, or what to serve.
 */
function admit(request: Request): Response | { workspaceId: string; token: string } {
  const match = PATH.exec(new URL(request.url).pathname);
  const workspaceId = match ? decoded(match[1]!) : null;
  // An id that is not one is the same 404 as one that is not yours.
  if (!workspaceId || !isUuid(workspaceId)) return json(404, { error: 'not_found' });

  // Stateless: there is no stream to open with GET and no session to end.
  if (request.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' }, { allow: 'POST' });
  }

  // MCP clients are programs, not pages: a browser's cross-site request
  // carries an Origin, and nothing here is meant to be driven from one.
  if (request.headers.has('origin')) return json(403, { error: 'forbidden' });

  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) return json(413, { error: 'too_large' });

  const token = bearer(request);
  if (!token || !AGENT_TOKEN.test(token)) {
    return json(
      401,
      { error: 'unauthorized', message: 'Send an agent token as Authorization: Bearer' },
      { 'www-authenticate': 'Bearer' },
    );
  }
  return { workspaceId, token };
}

export function createMcpHandler(options: McpOptions) {
  return async (request: Request): Promise<Response> => {
    if (new URL(request.url).pathname === '/health') return json(200, { ok: true });

    const admitted = admit(request);
    if (admitted instanceof Response) return admitted;
    const { workspaceId, token } = admitted;

    // A caller may name its run, so its calls are grouped as one (B6).
    const runKey = request.headers.get('x-robis-run');
    const api = new ApiClient(
      options.apiUrl,
      token,
      options.fetcher,
      runKey && RUN_KEY.test(runKey) ? runKey : null,
    );
    // A span per call, continuing the agent's trace if it sent one (A5).
    return inSpan(
      'POST /mcp/:workspaceId',
      {
        kind: SpanKind.SERVER,
        parent: contextFrom(request.headers.get('traceparent')),
        attributes: { 'robis.workspace_id': workspaceId },
      },
      () => answer(request, api, workspaceId, options),
    );
  };
}

async function answer(
  request: Request,
  api: ApiClient,
  workspaceId: string,
  options: McpOptions,
): Promise<Response> {
  const server = createToolServer(api, workspaceId, options.observe);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } catch (error) {
    console.error('mcp: request failed', error);
    return json(500, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32603, message: 'Internal error' },
    });
  } finally {
    await server.close();
  }
}
