import { createMcpHandler } from '@robis/mcp/server.ts';
import { getHarness } from './harness.ts';

/**
 * The MCP server and the API wired together in-process (B5): the MCP
 * server's calls to the API go to the test app, and callers reach the MCP
 * server through `mcpFetch`, as they would over the network.
 */

function headersOf(init: HeadersInit | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  new Headers(init).forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

/** The API, reached in-process: what the MCP server would fetch over the network. */
async function apiFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const { app } = await getHarness();
  const url = new URL(input instanceof Request ? input.url : input);
  const reply = await app.inject({
    method: (init?.method ?? 'GET') as 'GET',
    url: `${url.pathname}${url.search}`,
    headers: headersOf(init?.headers),
    payload: typeof init?.body === 'string' ? init.body : undefined,
  });
  return new Response(reply.statusCode === 204 ? null : reply.body, {
    status: reply.statusCode,
    headers: { 'content-type': String(reply.headers['content-type'] ?? 'application/json') },
  });
}

export const observed: { name: string; outcome: string }[] = [];

export const mcpHandler = createMcpHandler({
  apiUrl: 'http://api.internal',
  fetcher: apiFetch as typeof fetch,
  observe: (name, outcome) => observed.push({ name, outcome }),
});

/** The MCP server, reached in-process. */
export const mcpFetch = ((input: string | URL | Request, init?: RequestInit) =>
  mcpHandler(new Request(input, init))) as typeof fetch;
