import { createHmac, timingSafeEqual } from 'node:crypto';
import { type Database, issuePullRequests, issues, projects } from '@robis/database';
import type { IssueStatus } from '@robis/shared';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { applyIssueUpdate } from '../routes/issue-writes.ts';

/**
 * A pull request from GitHub's webhook (C7). Its title and branch are read
 * for issue keys (WEB-12, or web-12 in a branch name); each key that names
 * an issue in this workspace links the pull request to it, with its state.
 * A merge moves the issue to done when the workspace chose that, once,
 * recorded in the trail as Robis's own change. GitHub's signature carries
 * no time, so each pull request keeps GitHub's own last-changed time and
 * an event no newer than it (a replay, or a late arrival) changes nothing.
 * Any repository holding the secret may name any key in the workspace.
 */

/** A key: a project's letters and digits, a dash, the issue's number. */
const KEY = /\b([A-Za-z][A-Za-z0-9]{0,9})-(\d{1,9})\b/g;
/** Keys read from one pull request at most; more is noise, not intent. */
const KEYS_MAX = 10;

export function keysIn(...texts: string[]): { key: string; number: number }[] {
  const found = new Map<string, { key: string; number: number }>();
  for (const text of texts) {
    for (const match of text.matchAll(KEY)) {
      const key = match[1]!.toUpperCase();
      const number = Number(match[2]);
      found.set(`${key}-${number}`, { key, number });
      if (found.size >= KEYS_MAX) return [...found.values()];
    }
  }
  return [...found.values()];
}

/** Whether `header` is GitHub's signature of `body` with `secret`, compared in constant time. */
export function signedByGitHub(secret: string, body: Buffer, header: string | undefined): boolean {
  if (!header) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(body).digest('hex')}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const eventSchema = z.object({
  action: z.string(),
  pull_request: z.object({
    number: z.number().int(),
    title: z.string().max(1000),
    // A link people will click: https only, never javascript: or data:.
    html_url: z
      .string()
      .max(500)
      .refine((url) => {
        try {
          return new URL(url).protocol === 'https:';
        } catch {
          return false;
        }
      }),
    updated_at: z.string().datetime({ offset: true }),
    state: z.enum(['open', 'closed']),
    merged: z.boolean().nullable().optional(),
    draft: z.boolean().nullable().optional(),
    head: z.object({ ref: z.string().max(500) }),
  }),
  repository: z.object({ full_name: z.string().max(200) }),
});

type PullRequestEvent = z.infer<typeof eventSchema>;

export function parsePullRequest(body: unknown): PullRequestEvent | null {
  const parsed = eventSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

function stateOf(pr: PullRequestEvent['pull_request']) {
  if (pr.merged) return 'merged' as const;
  if (pr.state === 'closed') return 'closed' as const;
  return pr.draft ? ('draft' as const) : ('open' as const);
}

const SYSTEM = { id: null, kind: 'system' as const };
const SETTLED: readonly IssueStatus[] = ['DONE', 'CANCELED'];

/** Link the pull request to the issues it names; how many, and how many moved to done. */
export async function linkPullRequest(
  db: Database,
  workspaceId: string,
  event: PullRequestEvent,
  moveToDone: boolean,
): Promise<{ linked: number; moved: number }> {
  const pr = event.pull_request;
  const keys = keysIn(pr.title, pr.head.ref);
  if (keys.length === 0) return { linked: 0, moved: 0 };
  const state = stateOf(pr);
  const changedAt = new Date(pr.updated_at);
  let linked = 0;
  let moved = 0;
  for (const { key, number } of keys) {
    await db.transaction(async (tx) => {
      const [issue] = await tx
        .select({
          id: issues.id,
          title: issues.title,
          status: issues.status,
          priority: issues.priority,
          assigneeId: issues.assigneeId,
        })
        .from(issues)
        .innerJoin(projects, eq(projects.id, issues.projectId))
        .where(
          and(
            eq(issues.workspaceId, workspaceId),
            eq(projects.key, key),
            eq(issues.number, number),
          ),
        );
      if (!issue) return;
      const [before] = await tx
        .select({
          state: issuePullRequests.state,
          githubUpdatedAt: issuePullRequests.githubUpdatedAt,
        })
        .from(issuePullRequests)
        .where(
          and(
            eq(issuePullRequests.issueId, issue.id),
            eq(issuePullRequests.repo, event.repository.full_name),
            eq(issuePullRequests.number, pr.number),
          ),
        )
        .for('update');
      // A replay, or a delivery that arrived after a newer one: nothing to do.
      if (before && before.githubUpdatedAt >= changedAt) return;
      const fields = {
        title: pr.title.slice(0, 300),
        url: pr.html_url,
        state,
        githubUpdatedAt: changedAt,
      };
      await tx
        .insert(issuePullRequests)
        .values({
          issueId: issue.id,
          workspaceId,
          repo: event.repository.full_name,
          number: pr.number,
          ...fields,
        })
        .onConflictDoUpdate({
          target: [issuePullRequests.issueId, issuePullRequests.repo, issuePullRequests.number],
          set: { ...fields, updatedAt: sql`now()` },
        });
      linked++;
      // Only the first merge GitHub reports moves the issue: a later
      // delivery cannot close again an issue someone reopened.
      const firstMerge = state === 'merged' && before?.state !== 'merged';
      if (!firstMerge || !moveToDone || SETTLED.includes(issue.status)) return;
      await applyIssueUpdate(tx, SYSTEM, {
        workspaceId,
        issueId: issue.id,
        issueKey: `${key}-${number}`,
        title: issue.title,
        input: { status: 'DONE' },
        delegateId: null,
        previous: { status: issue.status, priority: issue.priority, assigneeId: issue.assigneeId },
      });
      moved++;
    });
  }
  return { linked, moved };
}
