import { issueAgentToken, revokeAgentToken } from '@robis/auth';
import { type Database, workspaces } from '@robis/database';
import type { TriageJob } from '@robis/shared';
import { log } from '@robis/telemetry/log';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { callTool } from './mcp-call.ts';
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
/** Summaries one workspace may ask for in a day: a bound on what a flood of issues costs. */
export const SUMMARIES_PER_WORKSPACE_PER_DAY = 200;
/** Summaries remembered per issue, so a retried job does not pay for one twice. */
const REMEMBERED_SUMMARIES = 500;

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
  if (summary) lines.push('', `Summary (written by a language model, unchecked): ${summary}`);

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
  /** Defaults to `SUMMARIES_PER_WORKSPACE_PER_DAY`. */
  summariesPerDay?: number;
};

/** The workspace's triage agent, and whether it opted in to summaries. */
async function triageAgentOf(db: Database, workspaceId: string) {
  const [row] = await db
    .select({ agentId: workspaces.triageAgentId, summaries: workspaces.triageSummaries })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row?.agentId ? { agentId: row.agentId, summaries: row.summaries } : null;
}

/**
 * The summarizer, bounded: at most so many calls per workspace a day, and
 * each issue's summary remembered, so a job retried after its comment
 * failed does not pay again. Kept in the worker's memory; a restart starts
 * the day's count again, which the provider key's own spend limit backs.
 */
function bounded(summarize: Summarizer, perDay: number) {
  const used = new Map<string, { day: string; count: number }>();
  const remembered = new Map<string, string | null>();

  return async (workspaceId: string, issueId: string, issue: Parameters<Summarizer>[0]) => {
    if (remembered.has(issueId)) return remembered.get(issueId) ?? null;
    const day = new Date().toISOString().slice(0, 10);
    const spent = used.get(workspaceId);
    const count = spent?.day === day ? spent.count : 0;
    if (count >= perDay) return null;
    used.set(workspaceId, { day, count: count + 1 });

    const summary = await summarize(issue).catch(() => null);
    remembered.set(issueId, summary);
    if (remembered.size > REMEMBERED_SUMMARIES) {
      remembered.delete(remembered.keys().next().value!);
    }
    return summary;
  };
}

export function triageHandler(options: TriageOptions): JobHandler {
  const fetcher = options.fetcher ?? fetch;
  const summarizeBounded = options.summarize
    ? bounded(options.summarize, options.summariesPerDay ?? SUMMARIES_PER_WORKSPACE_PER_DAY)
    : null;

  return async (payload, { db }) => {
    const { workspaceId, issueId } = payload as TriageJob;
    const triage = await triageAgentOf(db, workspaceId);
    // The workspace stopped using one since the issue was filed.
    if (!triage) return;
    const { agentId } = triage;
    // Issue text leaves Robis only where the workspace said it may.
    const summarize = triage.summaries ? summarizeBounded : null;

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
      const summary = summarize ? await summarize(workspaceId, issueId, issue) : null;
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
        log.error('triage: could not revoke the run token', { err: error }),
      );
    }
  };
}
