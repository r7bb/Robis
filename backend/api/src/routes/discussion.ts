import { type Database, issueByKey, issues, messagesNaming, projects } from '@robis/database';
import { contracts, DISCUSSION_LIMIT, DISCUSSION_PREVIEW_CHARS, isUuid } from '@robis/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import { currentMembership, requireAuth, requireMembership } from '../plugins/authz.ts';

/** A scan of the workspace's messages still running then is stopped. */
const DISCUSSION_TIMEOUT = '3s';

/**
 * Issues and chat, joined by the key (the "discuss" pair). Both only read,
 * and both sit behind the membership guard: a stranger gets 404, and what
 * is shown of chat needs the right to read the rooms.
 */
export async function discussionRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  serve(
    app,
    contracts['issues.discussion'],
    {
      preHandler: [
        requireAuth,
        requireMembership(db, 'issue:read'),
        requireMembership(db, 'channel:read'),
      ],
    },
    async (request, { params: { issueId } }) => {
      const { workspaceId } = currentMembership(request);
      if (!isUuid(issueId)) throw ApiError.notFound('Issue not found');

      const [issue] = await db
        .select({ projectKey: projects.key, number: issues.number })
        .from(issues)
        .innerJoin(projects, eq(projects.id, issues.projectId))
        .where(and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)))
        .limit(1);
      if (!issue) throw ApiError.notFound('Issue not found');

      const found = await db.transaction(async (tx) => {
        await tx.execute(sql.raw(`set local statement_timeout = '${DISCUSSION_TIMEOUT}'`));
        return messagesNaming(tx, workspaceId, `${issue.projectKey}-${issue.number}`, {
          limit: DISCUSSION_LIMIT,
          preview: DISCUSSION_PREVIEW_CHARS,
        });
      });
      return { messages: found };
    },
  );

  serve(
    app,
    contracts['issues.byKey'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:read')] },
    async (request, { params: { key } }) => {
      const { workspaceId } = currentMembership(request);
      const issue = await issueByKey(db, workspaceId, key);
      if (!issue) throw ApiError.notFound('Issue not found');
      return { issue };
    },
  );
}
