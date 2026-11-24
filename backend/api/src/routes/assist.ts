import {
  ASSIST_JOB,
  type AssistInput,
  type AssistIssue,
  type AssistSnippet,
  assistRequests,
  comments,
  type Database,
  enqueue,
  issues,
  meetings,
  messages,
  projects,
  recordAudit,
  users,
  workspaces,
} from '@robis/database';
import { can, contracts, isUuid } from '@robis/shared';
import { and, asc, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import {
  auditActor,
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';
import { loadChannel } from './channels.ts';

/** Asks a person may make in an hour: each one is a paid call. */
const ASKS_PER_HOUR = 30;
const HOUR_MS = 3_600_000;
/** What a summary reads: the latest of these, enough to catch up on. */
const COMMENTS_READ = 100;
const MESSAGES_READ = 150;
/** How long an ask and its answer are kept: long enough to read, no longer. */
const KEPT_MS = 24 * HOUR_MS;
/** Issue keys a meeting may name for its agenda. */
const AGENDA_ISSUES = 20;
/** REL-12 and the like, as chat links them. */
const ISSUE_KEY = /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{0,9})-(\d{1,9})(?![A-Za-z0-9])/g;

/** Every key a text names, in order, once each. */
function keysIn(text: string): { prefix: string; number: number }[] {
  const seen = new Set<string>();
  const found: { prefix: string; number: number }[] = [];
  for (const match of text.matchAll(ISSUE_KEY)) {
    const prefix = match[1]!.toUpperCase();
    const number = Number(match[2]);
    const key = `${prefix}-${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ prefix, number });
  }
  return found;
}

/**
 * Assistance (D3): every route but the status answers 404 until the server
 * has a key and an admin has turned it on here, so a workspace without it
 * sees exactly what it always did. Each ask reads only what the asker may
 * read, sends it to the provider as quoted data, and returns what came back
 * after `@robis/worker/assist` has checked it. Nothing is saved or posted.
 */
export async function assistRoutes(app: FastifyInstance, opts: { db: Database; keyed: boolean }) {
  const { db, keyed } = opts;
  const askLimit = rateLimit({ name: 'assist', limit: ASKS_PER_HOUR, windowMs: HOUR_MS });

  async function enabledHere(workspaceId: string): Promise<boolean> {
    const [row] = await db
      .select({ on: workspaces.assistEnabled })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    return row?.on === true;
  }

  /** Whether this workspace may ask; otherwise not found, as before it existed. */
  async function assertAvailable(request: FastifyRequest) {
    const { workspaceId } = currentMembership(request);
    if (!keyed || !(await enabledHere(workspaceId))) throw ApiError.notFound('Not found');
  }

  /**
   * An ask, for the worker to answer: the row and its job together, and the
   * asker's old asks cleared away first, so nothing is kept longer than a day.
   */
  async function ask(request: FastifyRequest, input: AssistInput) {
    const { workspaceId } = currentMembership(request);
    const userId = currentUser(request).id;
    const id = await db.transaction(async (tx) => {
      await tx
        .delete(assistRequests)
        .where(
          and(
            eq(assistRequests.userId, userId),
            lt(assistRequests.createdAt, new Date(Date.now() - KEPT_MS)),
          ),
        );
      const [row] = await tx
        .insert(assistRequests)
        .values({ workspaceId, userId, kind: input.kind, input: JSON.stringify(input) })
        .returning({ id: assistRequests.id });
      await enqueue(tx, ASSIST_JOB, { requestId: row!.id });
      return row!.id;
    });
    return { request: { id } };
  }

  serve(
    app,
    contracts['assist.status'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read')] },
    async (request) => ({
      enabled: await enabledHere(currentMembership(request).workspaceId),
      keyed,
    }),
  );

  serve(
    app,
    contracts['assist.configure'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:update')] },
    async (request, { body: { enabled } }) => {
      const { workspaceId } = currentMembership(request);
      await db.transaction(async (tx) => {
        await tx
          .update(workspaces)
          .set({ assistEnabled: enabled, updatedAt: new Date() })
          .where(eq(workspaces.id, workspaceId));
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'workspace',
          entityId: workspaceId,
          eventType: 'workspace.assist_enabled',
          payload: { enabled },
        });
      });
      return { enabled };
    },
  );

  /** An issue's description and comments, newest kept, as snippets. */
  async function issueSnippets(workspaceId: string, issueId: string) {
    if (!isUuid(issueId)) throw ApiError.notFound('Issue not found');
    const [issue] = await db
      .select({ id: issues.id, title: issues.title, description: issues.description })
      .from(issues)
      .where(and(eq(issues.id, issueId), eq(issues.workspaceId, workspaceId)));
    if (!issue) throw ApiError.notFound('Issue not found');
    const rows = await db
      .select({ id: comments.id, author: users.name, text: comments.body })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(eq(comments.issueId, issue.id))
      .orderBy(desc(comments.createdAt))
      .limit(COMMENTS_READ);
    const snippets: AssistSnippet[] = rows.reverse();
    if (issue.description) {
      snippets.unshift({ id: issue.id, author: 'the issue', text: issue.description });
    }
    return { subject: issue.title, snippets };
  }

  /** A channel's latest messages, as snippets. */
  async function channelSnippets(workspaceId: string, channelId: string) {
    const channel = await loadChannel(db, workspaceId, channelId);
    const rows = await db
      .select({ id: messages.id, author: users.name, text: messages.body })
      .from(messages)
      .innerJoin(users, eq(users.id, messages.authorId))
      .where(and(eq(messages.channelId, channel.id), sql`${messages.body} <> ''`))
      .orderBy(desc(messages.createdAt))
      .limit(MESSAGES_READ);
    return { subject: `#${channel.name}`, snippets: rows.reverse() as AssistSnippet[] };
  }

  serve(
    app,
    contracts['assist.summary'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read'), askLimit] },
    async (request, { body: { kind, id } }) => {
      await assertAvailable(request);
      const { workspaceId, role } = currentMembership(request);
      const permission = kind === 'issue' ? 'issue:read' : 'channel:read';
      if (!can(role, permission)) throw ApiError.forbidden();
      const { subject, snippets } =
        kind === 'issue'
          ? await issueSnippets(workspaceId, id)
          : await channelSnippets(workspaceId, id);
      if (snippets.length === 0) throw ApiError.badRequest('Nothing to summarise yet', 'empty');
      return ask(request, { kind: 'summary', subject, snippets });
    },
  );

  serve(
    app,
    contracts['assist.agenda'],
    { preHandler: [requireAuth, requireMembership(db, 'meeting:read'), askLimit] },
    async (request, { body: { meetingId } }) => {
      await assertAvailable(request);
      const { workspaceId, role } = currentMembership(request);
      if (!can(role, 'issue:read')) throw ApiError.forbidden();
      const [meeting] = await db
        .select({ title: meetings.title, agenda: meetings.agenda })
        .from(meetings)
        .where(and(eq(meetings.id, meetingId), eq(meetings.workspaceId, workspaceId)));
      if (!meeting) throw ApiError.notFound('Meeting not found');
      const keys = keysIn(`${meeting.title}\n${meeting.agenda ?? ''}`).slice(0, AGENDA_ISSUES);
      const named = await issuesByKey(workspaceId, keys);
      if (named.length === 0) {
        throw ApiError.badRequest(
          'Name the issues to talk about in the meeting, by key (like REL-12), then try again',
          'no_issues_named',
        );
      }
      return ask(request, { kind: 'agenda', meeting: meeting.title, issues: named });
    },
  );

  async function issuesByKey(
    workspaceId: string,
    keys: { prefix: string; number: number }[],
  ): Promise<AssistIssue[]> {
    if (keys.length === 0) return [];
    return db
      .select({
        id: issues.id,
        key: sql<string>`${projects.key} || '-' || ${issues.number}`,
        title: issues.title,
        status: issues.status,
        description: issues.description,
      })
      .from(issues)
      .innerJoin(projects, eq(projects.id, issues.projectId))
      .where(
        and(
          eq(issues.workspaceId, workspaceId),
          or(
            ...keys.map((k) =>
              and(eq(sql`upper(${projects.key})`, k.prefix), eq(issues.number, k.number)),
            ),
          ),
        ),
      )
      .orderBy(asc(projects.key), asc(issues.number));
  }

  serve(
    app,
    contracts['assist.issue'],
    { preHandler: [requireAuth, requireMembership(db, 'channel:read'), askLimit] },
    async (request, { body: { messageId } }) => {
      await assertAvailable(request);
      const { workspaceId } = currentMembership(request);
      const [message] = await db
        .select({ body: messages.body })
        .from(messages)
        .where(and(eq(messages.id, messageId), eq(messages.workspaceId, workspaceId)));
      if (!message?.body.trim()) throw ApiError.notFound('Message not found');
      return ask(request, { kind: 'issue', message: message.body });
    },
  );

  serve(
    app,
    contracts['assist.result'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read')] },
    async (request, { params: { requestId } }) => {
      const { workspaceId } = currentMembership(request);
      if (!isUuid(requestId)) throw ApiError.notFound('Not found');
      const [row] = await db
        .select({ status: assistRequests.status, result: assistRequests.result })
        .from(assistRequests)
        .where(
          and(
            eq(assistRequests.id, requestId),
            eq(assistRequests.workspaceId, workspaceId),
            // Only whoever asked reads the answer.
            eq(assistRequests.userId, currentUser(request).id),
          ),
        );
      if (!row) throw ApiError.notFound('Not found');
      const stored = typeof row.result === 'string' ? JSON.parse(row.result) : row.result;
      return { status: row.status, result: row.status === 'done' ? (stored ?? null) : null };
    },
  );
}
