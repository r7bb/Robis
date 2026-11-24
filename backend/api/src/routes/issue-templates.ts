import {
  type Database,
  type Executor,
  issueTemplates,
  labels,
  publishEvent,
} from '@robis/database';
import { can, contracts, ISSUE_TEMPLATES_MAX, isUuid } from '@robis/shared';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
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
import { withIdempotency } from '../plugins/idempotency.ts';
import { fileIssue } from './issues.ts';
import { replaceLabels } from './labels.ts';
import { loadProject } from './projects.ts';

/**
 * Of these label ids, those still the workspace's, in the order given. In a
 * transaction, `hold` keeps them from being removed until it commits.
 */
async function labelsStillHere(
  db: Executor,
  workspaceId: string,
  ids: readonly string[],
  hold = false,
) {
  if (ids.length === 0) return [];
  const query = db
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.workspaceId, workspaceId), inArray(labels.id, [...ids])));
  const rows = hold ? await query.for('share') : await query;
  const here = new Set(rows.map((row) => row.id));
  return ids.filter((id) => here.has(id));
}

/**
 * Issue templates: kept for the workspace, filed onto any of its boards by
 * the same code as any new issue, its labels set in the same transaction.
 */
export async function issueTemplateRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  async function templateIn(request: FastifyRequest, templateId: string) {
    const { workspaceId } = currentMembership(request);
    if (!isUuid(templateId)) throw ApiError.notFound('Template not found');
    const [row] = await db
      .select()
      .from(issueTemplates)
      .where(and(eq(issueTemplates.id, templateId), eq(issueTemplates.workspaceId, workspaceId)));
    if (!row) throw ApiError.notFound('Template not found');
    return row;
  }

  serve(
    app,
    contracts['issueTemplates.list'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:read')] },
    async (request) => {
      const { workspaceId } = currentMembership(request);
      const templates = await db
        .select()
        .from(issueTemplates)
        .where(eq(issueTemplates.workspaceId, workspaceId))
        .orderBy(asc(issueTemplates.name), asc(issueTemplates.createdAt));
      return { templates };
    },
  );

  serve(
    app,
    contracts['issueTemplates.create'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:create')] },
    async (request, { body }) => {
      const { workspaceId } = currentMembership(request);
      const wanted = [...new Set(body.labelIds.map((id) => id.toLowerCase()))];
      if ((await labelsStillHere(db, workspaceId, wanted)).length !== wanted.length) {
        throw ApiError.badRequest('A label is not one of this workspace’s', 'bad_label');
      }
      const [kept] = await db
        .select({ n: count() })
        .from(issueTemplates)
        .where(eq(issueTemplates.workspaceId, workspaceId));
      if ((kept?.n ?? 0) >= ISSUE_TEMPLATES_MAX) {
        throw ApiError.badRequest(
          `A workspace keeps up to ${ISSUE_TEMPLATES_MAX} templates`,
          'too_many_templates',
        );
      }
      const [template] = await db
        .insert(issueTemplates)
        .values({
          workspaceId,
          name: body.name,
          title: body.title,
          description: body.description || null,
          priority: body.priority,
          labelIds: wanted,
          createdBy: currentUser(request).id,
        })
        .returning();
      return { template: template! };
    },
  );

  serve(
    app,
    contracts['issueTemplates.remove'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:create')] },
    async (request, { params: { templateId } }) => {
      const { role } = currentMembership(request);
      const template = await templateIn(request, templateId);
      if (template.createdBy !== currentUser(request).id && !can(role, 'project:delete')) {
        throw ApiError.forbidden();
      }
      await db.delete(issueTemplates).where(eq(issueTemplates.id, template.id));
      return undefined;
    },
  );

  serve(
    app,
    contracts['issueTemplates.file'],
    { preHandler: [requireAuth, requireMembership(db, 'issue:create')] },
    async (request, { params: { templateId }, body }, reply) => {
      const user = currentUser(request);
      const { workspaceId } = currentMembership(request);
      const template = await templateIn(request, templateId);
      const project = await loadProject(db, workspaceId, body.projectId);

      return withIdempotency(db, request, reply, 201, async () => {
        const issue = await db.transaction(async (tx) => {
          const filed = await fileIssue(tx, auditActor(request), {
            user,
            workspaceId,
            projectId: project.id,
            input: {
              title: body.title ?? template.title,
              ...(template.description ? { description: template.description } : {}),
              status: 'TODO',
              priority: template.priority,
            },
          });
          const wanted = await labelsStillHere(tx, workspaceId, template.labelIds, true);
          if (wanted.length > 0) {
            await replaceLabels(tx, auditActor(request), {
              workspaceId,
              issueId: filed.id,
              wanted,
            });
          }
          return filed;
        });
        await publishEvent(db, {
          type: 'issue.created',
          workspaceId,
          projectId: project.id,
          issueId: issue.id,
          actorId: user.id,
        });
        return { issue: { id: issue.id, key: issue.key } };
      });
    },
  );
}
