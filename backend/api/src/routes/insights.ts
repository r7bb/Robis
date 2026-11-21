import {
  auditEvents,
  type Database,
  issues,
  projects,
  queueStats,
  readInstrument,
  suggestionFeedback,
  users,
} from '@robis/database';
import {
  contracts,
  HEALTH_HOURS,
  INSIGHT_MIN_SAMPLE,
  INSIGHT_WEEKS,
  SUGGESTION_DAYS,
} from '@robis/shared';
import { and, asc, count, eq, gte } from 'drizzle-orm';
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
import { acceptanceOf, readingOf } from '../insights/health.ts';
import { isOperator } from '../insights/operators.ts';
import {
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';

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

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** This workspace's hint answers since a moment, by kind. */
async function hintAnswers(db: Database, workspaceId: string, since: Date) {
  const rows = await db
    .select({ kind: suggestionFeedback.kind, action: suggestionFeedback.action, n: count() })
    .from(suggestionFeedback)
    .where(and(eq(suggestionFeedback.workspaceId, workspaceId), gte(suggestionFeedback.at, since)))
    .groupBy(suggestionFeedback.kind, suggestionFeedback.action);
  const of = (kind: 'duplicate' | 'priority', action: 'accepted' | 'dismissed') =>
    rows.find((row) => row.kind === kind && row.action === action)?.n ?? 0;
  return {
    days: SUGGESTION_DAYS as typeof SUGGESTION_DAYS,
    duplicate: acceptanceOf(of('duplicate', 'accepted'), of('duplicate', 'dismissed')),
    priority: acceptanceOf(of('priority', 'accepted'), of('priority', 'dismissed')),
  };
}

/** The server's queue as it is now, and a day of every instance's timings. */
async function serverHealth(db: Database, since: Date) {
  const [queue, syncLag, fanOut] = await Promise.all([
    queueStats(db),
    readInstrument(db, 'sync_lag', since),
    readInstrument(db, 'fanout_latency', since),
  ]);
  return {
    queue: {
      due: queue.due,
      oldestDueSeconds: queue.due === 0 ? null : queue.oldestDueSeconds,
      deadLetters: queue.dead,
    },
    syncLag: readingOf(syncLag),
    fanOut: readingOf(fanOut),
  };
}

/** Whether this person runs the server: a configured, verified address. */
async function runsTheServer(db: Database, operators: readonly string[], userId: string) {
  if (operators.length === 0) return false;
  const [row] = await db
    .select({ email: users.email, verifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, userId));
  return row?.verifiedAt != null && isOperator(operators, row.email);
}

/**
 * System health (Phase 6), from real instruments: a month of this
 * workspace's hint answers and, for the server's operators only, its job
 * queue and a day of the timings every instance records.
 */
async function healthOf(db: Database, workspaceId: string, operator: boolean, now: Date) {
  const since = new Date(now.getTime() - HEALTH_HOURS * HOUR_MS);
  const [server, suggestions] = await Promise.all([
    operator ? serverHealth(db, since) : null,
    hintAnswers(db, workspaceId, new Date(now.getTime() - SUGGESTION_DAYS * DAY_MS)),
  ]);
  return {
    since: since.toISOString(),
    hours: HEALTH_HOURS as typeof HEALTH_HOURS,
    minSample: INSIGHT_MIN_SAMPLE as typeof INSIGHT_MIN_SAMPLE,
    server,
    suggestions,
  };
}

export async function insightRoutes(
  app: FastifyInstance,
  opts: { db: Database; operators: readonly string[] },
) {
  const { db, operators } = opts;

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

  serve(
    app,
    contracts['insights.health'],
    { preHandler: [requireAuth, requireMembership(db, 'health:read')] },
    async (request) => {
      const operator = await runsTheServer(db, operators, currentUser(request).id);
      return healthOf(db, currentMembership(request).workspaceId, operator, new Date());
    },
  );
}
