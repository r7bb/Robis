import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ISSUE_STATUSES, STORY_TEXT_MAX_LENGTH, STORY_TONES } from '@robis/shared';
import { inSpan } from '@robis/telemetry';
import { log } from '@robis/telemetry/log';
import { z } from 'zod';
import { type ApiClient, ApiRefusal } from './api-client.ts';

/**
 * The tools an agent sees (B5): search, read an issue, create one, update
 * one, comment, and two reads besides: suggestions for a title (the hints
 * the composer shows a person) and the list of projects (an issue belongs
 * to one). Every tool is a call to the API as the agent; the
 * fixed list is also the label set for the server's metrics.
 */
export const TOOL_NAMES = [
  'search',
  'suggest',
  'list_projects',
  'read_issue',
  'create_issue',
  'update_issue',
  'comment',
  'post_shot',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** A write's key: the same key makes a retried write happen once. */
const idempotencyKey = z
  .string()
  .min(8)
  .max(200)
  .describe(
    'A unique key for this write, such as a UUID. Send the same key again to retry safely: the write happens once.',
  );

const uuid = z.string().uuid();

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const ok = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
});

/** A refusal in the API's own words: its status, code and message. */
const refused = (error: ApiRefusal): ToolResult => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify({ status: error.status, error: error.code, message: error.message }),
    },
  ],
  isError: true,
});

export type ToolOutcome = 'ok' | 'denied' | 'error';

/**
 * Anything other than an API refusal (the API unreachable, a timeout, an
 * answer that does not match its contract) is logged here and reported to
 * the agent only as an internal error: its message could name the API's
 * address inside the stack, or echo part of an answer.
 */
const internal: ToolResult = {
  content: [{ type: 'text', text: JSON.stringify({ status: 500, error: 'internal' }) }],
  isError: true,
};

const DENIED_STATUSES = new Set([401, 403, 404]);

/** Runs a tool, turning an API refusal into a tool error the agent can read. */
async function run(
  name: ToolName,
  observe: (name: ToolName, outcome: ToolOutcome, ms: number) => void,
  work: () => Promise<unknown>,
): Promise<ToolResult> {
  // A span per tool call (A5); the API requests it makes are its children.
  return inSpan(`tool ${name}`, { attributes: { 'robis.mcp.tool': name } }, async (span) => {
    const began = performance.now();
    try {
      const result = ok(await work());
      observe(name, 'ok', performance.now() - began);
      return result;
    } catch (error) {
      const ms = performance.now() - began;
      if (error instanceof ApiRefusal) {
        const outcome = DENIED_STATUSES.has(error.status) ? 'denied' : 'error';
        span.setAttribute('robis.mcp.outcome', outcome);
        observe(name, outcome, ms);
        return refused(error);
      }
      log.error(`mcp: ${name} failed`, { err: error });
      span.setAttribute('robis.mcp.outcome', 'error');
      observe(name, 'error', ms);
      return internal;
    }
  });
}

export function createToolServer(
  api: ApiClient,
  workspaceId: string,
  observe: (name: ToolName, outcome: ToolOutcome, ms: number) => void = () => {},
): McpServer {
  const server = new McpServer({ name: 'robis', version: '1.0.0' });
  const params = { workspaceId };

  server.registerTool(
    'search',
    {
      description: 'Search the workspace’s issues, documents and comments, best match first.',
      inputSchema: { query: z.string().min(1).max(200) },
    },
    ({ query }) =>
      run('search', observe, () =>
        api.call('search.workspace', { tool: 'search', params, query: { q: query } }),
      ),
  );

  server.registerTool(
    'suggest',
    {
      description:
        'For a title (and description): issues it may duplicate, with similarity scores, and a suggested priority with its score. Advice only, the same hints a person sees while writing.',
      inputSchema: {
        title: z.string().min(1).max(200),
        description: z.string().max(10_000).optional(),
      },
    },
    ({ title, description }) =>
      run('suggest', observe, () =>
        api.call('issues.suggestions', {
          tool: 'suggest',
          params,
          query: { title, ...(description ? { description } : {}) },
        }),
      ),
  );

  server.registerTool(
    'list_projects',
    { description: 'The workspace’s projects, with their ids, for creating an issue in one.' },
    () =>
      run('list_projects', observe, () =>
        api.call('projects.list', { tool: 'list_projects', params }),
      ),
  );

  server.registerTool(
    'read_issue',
    {
      description: 'One issue with its comments.',
      inputSchema: { issueId: uuid },
    },
    ({ issueId }) =>
      run('read_issue', observe, async () => {
        const [{ issue }, { comments }] = await Promise.all([
          api.call('issues.get', { tool: 'read_issue', params: { ...params, issueId } }),
          api.call('comments.list', { tool: 'read_issue', params: { ...params, issueId } }),
        ]);
        return { issue, comments };
      }),
  );

  server.registerTool(
    'create_issue',
    {
      description:
        'File an issue in a project. It records you as its delegate; a person stays responsible for it.',
      inputSchema: {
        projectId: uuid,
        title: z.string().min(1).max(200),
        description: z.string().max(10_000).optional(),
        idempotencyKey,
      },
    },
    ({ projectId, title, description, idempotencyKey: key }) =>
      run('create_issue', observe, () =>
        api.call('issues.create', {
          tool: 'create_issue',
          params: { ...params, projectId },
          body: { title, ...(description ? { description } : {}) },
          idempotencyKey: key,
        }),
      ),
  );

  server.registerTool(
    'update_issue',
    {
      description:
        'Change an issue’s title, description or status. Priority and assignee are for people to decide.',
      inputSchema: {
        issueId: uuid,
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(10_000).optional(),
        status: z.enum(ISSUE_STATUSES).optional(),
        idempotencyKey,
      },
    },
    ({ issueId, idempotencyKey: key, ...changes }) =>
      run('update_issue', observe, () =>
        api.call('issues.update', {
          tool: 'update_issue',
          params: { ...params, issueId },
          body: changes,
          idempotencyKey: key,
        }),
      ),
  );

  server.registerTool(
    'comment',
    {
      description: 'Comment on an issue.',
      inputSchema: { issueId: uuid, body: z.string().min(1).max(10_000), idempotencyKey },
    },
    ({ issueId, body, idempotencyKey: key }) =>
      run('comment', observe, () =>
        api.call('comments.create', {
          tool: 'comment',
          params: { ...params, issueId },
          body: { body },
          idempotencyKey: key,
        }),
      ),
  );

  server.registerTool(
    'post_shot',
    {
      description:
        'Post a Different shot: a short idea for the team to try, shown as a story for 24 hours, with a Try it button that opens a place in this workspace (a path such as /workspaces/<id>/feed) or the account page.',
      inputSchema: {
        body: z.string().min(1).max(STORY_TEXT_MAX_LENGTH),
        tone: z.enum(STORY_TONES),
        tryPath: z.string().min(1).max(200),
        tryLabel: z.string().min(1).max(24),
        idempotencyKey,
      },
    },
    ({ idempotencyKey: key, ...shot }) =>
      run('post_shot', observe, () =>
        api.call('stories.createText', {
          tool: 'post_shot',
          params,
          body: shot,
          idempotencyKey: key,
        }),
      ),
  );

  return server;
}
