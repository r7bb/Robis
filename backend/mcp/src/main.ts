import { requireNodeEnv } from '@robis/shared';
import { portFrom } from '@robis/shared/config';
import { createMcpHandler, MAX_BODY_BYTES } from './server.ts';

/** Seconds a connection may sit idle: a tool call takes at most the API's 10 s. */
const IDLE_TIMEOUT_SECONDS = 30;

/**
 * The MCP server (B5): `bun backend/mcp/src/main.ts`.
 *
 * It needs only the API's address from inside the stack; it has no
 * database account, no secrets and no authority of its own.
 */

const nodeEnv = requireNodeEnv(process.env.NODE_ENV);
const apiUrl = process.env.MCP_API_URL ?? (nodeEnv === 'production' ? '' : 'http://127.0.0.1:4000');
if (!apiUrl) throw new Error('MCP_API_URL is required in production: where the API answers.');
try {
  new URL(apiUrl);
} catch {
  throw new Error(`MCP_API_URL is not a URL: ${apiUrl}`);
}

const port = portFrom(process.env, 'MCP_PORT', 4002);
const server = Bun.serve({
  port,
  hostname: process.env.MCP_HOST ?? '127.0.0.1',
  maxRequestBodySize: MAX_BODY_BYTES,
  idleTimeout: IDLE_TIMEOUT_SECONDS,
  fetch: createMcpHandler({ apiUrl }),
});

console.log(`MCP server listening on http://${server.hostname}:${server.port}/mcp/<workspace id>`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.stop();
    process.exit(0);
  });
}
