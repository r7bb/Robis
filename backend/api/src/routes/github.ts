import { generateSessionToken } from '@robis/auth';
import { type Database, githubLinks, issuePullRequests, recordAudit } from '@robis/database';
import { contracts, isUuid } from '@robis/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import { linkPullRequest, parsePullRequest, signedByGitHub } from '../github/pull-requests.ts';
import {
  auditActor,
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';

/**
 * GitHub pull requests on issues (C7). Admins connect, choose whether a
 * merge moves the issue to done, and disconnect; anyone who reads an issue
 * sees its pull requests. GitHub's webhook arrives at a public address and
 * is believed only when signed with the workspace's secret.
 */

/** The largest webhook body read; a pull request event is a few kilobytes. */
const WEBHOOK_MAX_BYTES = 1024 * 1024;

function jsonOf(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw ApiError.badRequest('Not JSON', 'bad_json');
  }
}

const webhookPath = (workspaceId: string) => `/api/github/webhook/${workspaceId}`;
const wire = (row: typeof githubLinks.$inferSelect) => ({
  moveToDone: row.moveToDone,
  createdAt: row.createdAt,
  webhookPath: webhookPath(row.workspaceId),
});

export async function githubRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;
  const admin = [requireAuth, requireMembership(db, 'webhook:manage')];

  const linkOf = async (workspaceId: string) =>
    (await db.select().from(githubLinks).where(eq(githubLinks.workspaceId, workspaceId)))[0] ??
    null;

  serve(app, contracts['github.link'], { preHandler: admin }, async (request) => {
    const row = await linkOf(currentMembership(request).workspaceId);
    return { link: row ? wire(row) : null };
  });

  serve(app, contracts['github.connect'], { preHandler: admin }, async (request, { body }) => {
    const { workspaceId } = currentMembership(request);
    const secret = generateSessionToken();
    const row = await db.transaction(async (tx) => {
      const [saved] = await tx
        .insert(githubLinks)
        .values({
          workspaceId,
          secret,
          moveToDone: body.moveToDone,
          createdBy: currentUser(request).id,
        })
        .onConflictDoUpdate({
          target: githubLinks.workspaceId,
          set: { secret, moveToDone: body.moveToDone },
        })
        .returning();
      await recordAudit(tx, auditActor(request), {
        workspaceId,
        entityType: 'workspace',
        entityId: workspaceId,
        eventType: 'github.connected',
        payload: { moveToDone: body.moveToDone },
      });
      return saved!;
    });
    return { link: wire(row), secret };
  });

  serve(app, contracts['github.update'], { preHandler: admin }, async (request, { body }) => {
    const { workspaceId } = currentMembership(request);
    const [row] = await db
      .update(githubLinks)
      .set({ moveToDone: body.moveToDone })
      .where(eq(githubLinks.workspaceId, workspaceId))
      .returning();
    if (!row) throw ApiError.notFound('Not connected to GitHub');
    return { link: wire(row) };
  });

  serve(
    app,
    contracts['github.disconnect'],
    { preHandler: admin },
    async (request, _input, reply) => {
      const { workspaceId } = currentMembership(request);
      await db.transaction(async (tx) => {
        const gone = await tx
          .delete(githubLinks)
          .where(eq(githubLinks.workspaceId, workspaceId))
          .returning({ workspaceId: githubLinks.workspaceId });
        if (gone.length === 0) throw ApiError.notFound('Not connected to GitHub');
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'workspace',
          entityId: workspaceId,
          eventType: 'github.disconnected',
          payload: {},
        });
      });
      return reply.code(204).send();
    },
  );

  serve(
    app,
    contracts['issues.pullRequests'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:read')] },
    async (request, { params }) => {
      const { workspaceId } = currentMembership(request);
      const rows = await db
        .select()
        .from(issuePullRequests)
        .where(
          and(
            eq(issuePullRequests.workspaceId, workspaceId),
            eq(issuePullRequests.issueId, params.issueId),
          ),
        )
        .orderBy(desc(issuePullRequests.updatedAt));
      return {
        pullRequests: rows.map((pr) => ({
          repo: pr.repo,
          number: pr.number,
          title: pr.title,
          url: pr.url,
          state: pr.state as 'open' | 'draft' | 'merged' | 'closed',
          updatedAt: pr.updatedAt,
        })),
      };
    },
  );

  /**
   * The workspace's link, if the body carries its secret's signature. The
   * same refusal whatever is wrong, so the address says nothing about which
   * workspaces are connected.
   */
  async function signedLink(workspaceId: string, body: unknown, signature: string | undefined) {
    const row = isUuid(workspaceId) && body instanceof Buffer ? await linkOf(workspaceId) : null;
    if (!row || !signedByGitHub(row.secret, body as Buffer, signature)) {
      throw ApiError.unauthorized();
    }
    return row;
  }

  // GitHub's webhook, in a scope of its own that keeps the body as bytes:
  // the signature is over exactly what was sent.
  app.register(async (hook) => {
    hook.removeContentTypeParser('application/json');
    hook.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer', bodyLimit: WEBHOOK_MAX_BYTES },
      (_request, body, done) => done(null, body),
    );
    hook.post(
      '/github/webhook/:workspaceId',
      { preHandler: rateLimit({ name: 'github-webhook', limit: 120, windowMs: 60_000 }) },
      async (request, reply) => {
        const { workspaceId } = request.params as { workspaceId: string };
        const signature = request.headers['x-hub-signature-256'];
        const row = await signedLink(
          workspaceId,
          request.body,
          typeof signature === 'string' ? signature : undefined,
        );
        const event = request.headers['x-github-event'];
        if (event === 'ping') return reply.code(204).send();
        if (event !== 'pull_request') return reply.code(202).send({ linked: 0, moved: 0 });
        const pullRequest = parsePullRequest(jsonOf(request.body as Buffer));
        if (!pullRequest) throw ApiError.badRequest('Not a pull request event', 'bad_event');
        const result = await linkPullRequest(db, workspaceId, pullRequest, row.moveToDone);
        return reply.code(202).send(result);
      },
    );
  });
}
