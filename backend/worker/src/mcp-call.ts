/** One MCP tool call, as JSON-RPC over HTTP: the whole of what the scripted agents need. */
export async function callTool(
  fetcher: typeof fetch,
  endpoint: string,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetcher(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`MCP ${name}: HTTP ${response.status}`);
  const answer = (await response.json()) as {
    result?: { isError?: boolean; content?: { text?: string }[] };
    error?: { message?: string };
  };
  const text = answer.result?.content?.[0]?.text;
  if (!answer.result || answer.result.isError || !text) {
    throw new Error(`MCP ${name}: ${text ?? answer.error?.message ?? 'no result'}`);
  }
  return JSON.parse(text);
}
