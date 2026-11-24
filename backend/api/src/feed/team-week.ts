import type { Database } from '@robis/database';
import { contracts } from '@robis/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import { currentMembership, requireAuth, requireMembership } from '../plugins/authz.ts';

const WEEK_MS = 7 * 24 * 3_600_000;
/** Named at most, as finishing most. */
const FINISHERS_SHOWN = 3;

type Counts = {
  issues_done: number;
  issues_opened: number;
  answered: number;
  threads_started: number;
  meetings_held: number;
  documents_changed: number;
  messages: number;
};

/**
 * The team's week (feed): one pass of counts over the last seven days, each
 * scoped to the workspace, and the people who finished most. A meeting
 * counts once if it met in the window (a weekly repeat meets once in any
 * seven days between its first and last), and one called off does not.
 */
export async function teamWeekRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  serve(
    app,
    contracts['feed.week'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read')] },
    async (request) => {
      const { workspaceId } = currentMembership(request);
      const since = new Date(Date.now() - WEEK_MS);
      const from = sql`${since.toISOString()}::timestamptz`;
      const [counts] = await db.execute<Counts>(sql`
        select
          (select count(*)::int from issues where workspace_id = ${workspaceId}
             and status = 'DONE' and completed_at >= ${from}) as issues_done,
          (select count(*)::int from issues where workspace_id = ${workspaceId}
             and created_at >= ${from}) as issues_opened,
          (select count(*)::int from space_threads where workspace_id = ${workspaceId}
             and solved_at >= ${from}) as answered,
          (select count(*)::int from space_threads where workspace_id = ${workspaceId}
             and created_at >= ${from}) as threads_started,
          (select count(*)::int from meetings where workspace_id = ${workspaceId}
             and canceled_at is null and starts_at < now() and last_starts_at >= ${from}) as meetings_held,
          (select count(*)::int from documents where workspace_id = ${workspaceId}
             and updated_at >= ${from}) as documents_changed,
          (select count(*)::int from messages where workspace_id = ${workspaceId}
             and created_at >= ${from}) as messages
      `);
      const finishers = await db.execute<{ user_id: string; name: string; done: number }>(sql`
        select i.assignee_id as user_id, u.name, count(*)::int as done
          from issues i
          join users u on u.id = i.assignee_id and u.kind = 'human'
         where i.workspace_id = ${workspaceId} and i.status = 'DONE' and i.completed_at >= ${from}
         group by i.assignee_id, u.name
         order by done desc, u.name
         limit ${FINISHERS_SHOWN}
      `);
      const c = counts!;
      return {
        since,
        issuesDone: c.issues_done,
        issuesOpened: c.issues_opened,
        answered: c.answered,
        threadsStarted: c.threads_started,
        meetingsHeld: c.meetings_held,
        documentsChanged: c.documents_changed,
        messages: c.messages,
        finishers: [...finishers].map((row) => ({
          userId: row.user_id,
          name: row.name,
          done: row.done,
        })),
      };
    },
  );
}
