import { auditEvents, type Database, issues, projects } from '@robis/database';
import { contracts, INSIGHT_MIN_SAMPLE, INSIGHT_WEEKS } from '@robis/shared';
import { and, asc, eq, gte } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import {
  type DoneIssue,
  type IssueSpan,
  issueSpan,
  projectFlow,
  type StatusMove,
  windowStart,
} from '../insights/flow.ts';
import { currentMembership, requireAuth, requireMembership } from '../plugins/authz.ts';

/**
 * Insights (Phase 6): cycle time and throughput per project, from the
 * `issue.status_changed` events the audit trail already keeps. Nothing is
 * stored; the moves are read and worked out on each request.
 */

/**
 * The database stamps `completed_at` and the API stamps the audit event, on
 * two clocks; this margin keeps an issue finished at the window's edge from
 * being dropped by the first filter before the second, exact one sees it.
 */
const CLOCK_MARGIN_MS = 24 * 60 * 60 * 1000;

type MoveRow = {
  issueId: string;
  projectId: string;
  createdAt: Date;
  completedAt: Date | null;
  at: Date | null;
  payload: string | null;
};

/**
 * Every status move of each issue that is done and was finished in the
 * window, in trail order, for active projects. Done issues are found first
 * by `completed_at`; their moves then come from the partial index on status
 * changes, however long ago the first of them was. An issue filed already
 * done has no move, and comes back once with nulls.
 */
function finishedMoves(db: Database, workspaceId: string, since: Date): Promise<MoveRow[]> {
  const roughly = new Date(since.getTime() - CLOCK_MARGIN_MS);
  return db
    .select({
      issueId: issues.id,
      projectId: issues.projectId,
      createdAt: issues.createdAt,
      completedAt: issues.completedAt,
      at: auditEvents.createdAt,
      payload: auditEvents.payload,
    })
    .from(issues)
    .innerJoin(projects, and(eq(projects.id, issues.projectId), eq(projects.archived, false)))
    .leftJoin(
      auditEvents,
      and(
        eq(auditEvents.workspaceId, issues.workspaceId),
        eq(auditEvents.entityId, issues.id),
        eq(auditEvents.eventType, 'issue.status_changed'),
      ),
    )
    .where(
      and(
        eq(issues.workspaceId, workspaceId),
        eq(issues.status, 'DONE'),
        gte(issues.completedAt, roughly),
      ),
    )
    .orderBy(asc(issues.id), asc(auditEvents.seq));
}

/**
 * A move's from and to, read from the event's payload. Parsed here rather
 * than cast in SQL, so one row edited behind the application's back (the
 * hash chain's business) costs that move, not the whole page.
 */
function moveOf(row: MoveRow & { at: Date }, log: FastifyBaseLogger): StatusMove | null {
  try {
    const payload = JSON.parse(row.payload ?? '{}') as { from?: unknown; to?: unknown };
    const name = (value: unknown) => (typeof value === 'string' ? value : null);
    return { at: row.at, from: name(payload.from), to: name(payload.to) };
  } catch (error) {
    log.warn({ err: error, issueId: row.issueId }, 'a status move could not be read');
    return null;
  }
}

/** Each issue's span, grouped by project. */
function spansByProject(rows: readonly MoveRow[], log: FastifyBaseLogger) {
  const byIssue = new Map<
    string,
    { projectId: string; issue: DoneIssue & { moves: StatusMove[] } }
  >();
  for (const row of rows) {
    const entry = byIssue.get(row.issueId) ?? {
      projectId: row.projectId,
      issue: { createdAt: row.createdAt, completedAt: row.completedAt, moves: [] },
    };
    const move = row.at === null ? null : moveOf({ ...row, at: row.at }, log);
    if (move) entry.issue.moves.push(move);
    byIssue.set(row.issueId, entry);
  }
  const byProject = new Map<string, IssueSpan[]>();
  for (const { projectId, issue } of byIssue.values()) {
    const span = issueSpan(issue);
    if (span) byProject.set(projectId, [...(byProject.get(projectId) ?? []), span]);
  }
  return byProject;
}

export async function insightRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  serve(
    app,
    contracts['insights.flow'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:read')] },
    async (request) => {
      const { workspaceId } = currentMembership(request);
      const now = new Date();
      const since = windowStart(now);
      const [active, rows] = await Promise.all([
        db
          .select({ id: projects.id, key: projects.key, name: projects.name })
          .from(projects)
          .where(and(eq(projects.workspaceId, workspaceId), eq(projects.archived, false)))
          .orderBy(asc(projects.name)),
        finishedMoves(db, workspaceId, since),
      ]);
      const spans = spansByProject(rows, request.log);
      const flows = active.map((project) => ({
        ...project,
        ...projectFlow(spans.get(project.id) ?? [], now),
      }));
      // The busiest first; a tie keeps the alphabetical order above.
      flows.sort((a, b) => b.finished - a.finished);
      return {
        since: since.toISOString(),
        weeks: INSIGHT_WEEKS as typeof INSIGHT_WEEKS,
        minSample: INSIGHT_MIN_SAMPLE as typeof INSIGHT_MIN_SAMPLE,
        projects: flows,
      };
    },
  );
}
