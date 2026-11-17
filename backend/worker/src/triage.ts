import { issueAgentToken, revokeAgentToken } from '@robis/auth';
import { type Database, workspaces } from '@robis/database';
import type { TriageJob } from '@robis/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { JobHandler } from './runner.ts';

/**
 * The scripted triage agent (B5): no model of its own, no language model.
 *
 * On each new issue in a workspace that has chosen a triage agent, it
 * looks at the issue and the same hints the composer shows a person
 * (issues it may duplicate, and a suggested priority), and comments what
 * it found with the scores. It never sets the priority, or anything else:
 * it suggests, exactly as the composer does, and a person decides.
 *
 * It works as any agent does, through the MCP server with a token of its
 * own: minted for this one run, good for five minutes, revoked when the
 * run ends. So the API's permissions, retry ledger and audit trail apply
 * to it as to anyone, and the trail names it.
 */

/** How long a run's token lives if the run dies before revoking it. */
const RUN_TOKEN_TTL_MS = 5 * 60_000;
/** Duplicates worth naming, at most. */
const MAX_DUPLICATES = 3;

const similar = z.array(z.object({ id: z.string(), title: z.string(), score: z.number() }));
const suggestion = z
  .union([
    z.object({ priority: z.string(), score: z.number() }),
    z.object({ priority: z.null(), trainedOn: z.number(), needed: z.number() }),
  ])
  .nullable();
const hints = z.object({ similar, suggestion });
const issueRead = z.object({
  issue: z.object({ id: z.string(), title: z.string(), description: z.string().nullable() }),
});

export type TriageHints = z.infer<typeof hints>;

const percent = (score: number) => score.toFixed(2);

/**
 * What the agent says. Plain, scored, and explicit that nothing was
 * changed; `summary` is an optional one-line summary from a language model
 * (absent without one, and the comment is otherwise the same).
 */
export function triageComment(issueId: string, found: TriageHints, summary?: string | null) {
  const lines = ['Triage suggestions. Nothing on this issue was changed; a person decides.'];
  if (summary) lines.push('', `Summary: ${summary}`);

  const { suggestion: priority } = found;
  lines.push('');
  if (priority && 'score' in priority) {
    lines.push(
      `Priority: ${priority.priority} looks likely (score ${percent(priority.score)}). Not set.`,
    );
  } else if (priority) {
    lines.push(
      `Priority: no suggestion yet. The model learns from triaged issues and has ${priority.trainedOn} of the ${priority.needed} it needs.`,
    );
  } else {
    lines.push('Priority: no suggestion.');
  }

  const duplicates = found.similar.filter((s) => s.id !== issueId).slice(0, MAX_DUPLICATES);
  lines.push('');
  if (duplicates.length === 0) {
    lines.push('Possible duplicates: none found.');
  } else {
    lines.push('Possible duplicates:');
    // On one line: a title is someone's text, and must not pass for a line
    // of the agent's own, such as a priority.
    for (const d of duplicates) {
      lines.push(`- ${d.title.replace(/\s+/g, ' ').trim()} (similarity ${percent(d.score)})`);
    }
  }
  return lines.join('\n');
}

/** One MCP tool call, as JSON-RPC over HTTP: the whole of what this agent needs. */
async function callTool(
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

export type Summarizer = (issue: {
  title: string;
  description: string | null;
}) => Promise<string | null>;

export type TriageOptions = {
  /** Where the MCP server answers, from inside the stack. */
  mcpUrl: string;
  fetcher?: typeof fetch;
  /** The optional language model port; without one, the scripted agent alone. */
  summarize?: Summarizer;
};

async function triageAgentOf(db: Database, workspaceId: string): Promise<string | null> {
  const [row] = await db
    .select({ agentId: workspaces.triageAgentId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row?.agentId ?? null;
}

export function triageHandler(options: TriageOptions): JobHandler {
  const fetcher = options.fetcher ?? fetch;

  return async (payload, { db }) => {
    const { workspaceId, issueId } = payload as TriageJob;
    const agentId = await triageAgentOf(db, workspaceId);
    // The workspace stopped using one since the issue was filed.
    if (!agentId) return;

    const token = await issueAgentToken(db, {
      agentId,
      workspaceId,
      createdBy: agentId,
      label: 'triage run',
      expiresAt: new Date(Date.now() + RUN_TOKEN_TTL_MS),
    });
    const endpoint = `${options.mcpUrl}/mcp/${workspaceId}`;
    const call = (name: string, args: Record<string, unknown>) =>
      callTool(fetcher, endpoint, token.secret, name, args);

    try {
      const { issue } = issueRead.parse(await call('read_issue', { issueId }));
      const found = hints.parse(
        await call('suggest', {
          title: issue.title,
          ...(issue.description ? { description: issue.description } : {}),
        }),
      );
      const summary = options.summarize ? await options.summarize(issue).catch(() => null) : null;
      await call('comment', {
        issueId,
        body: triageComment(issueId, found, summary),
        // Keyed on the issue: a retried job comments once.
        idempotencyKey: `triage:${issueId}`,
      });
    } finally {
      // Logged rather than thrown, so a failed revoke never hides the run's
      // own error; the token expires within minutes regardless.
      await revokeAgentToken(db, { tokenId: token.id, agentId, workspaceId }).catch((error) =>
        console.error('triage: could not revoke the run token', error),
      );
    }
  };
}
