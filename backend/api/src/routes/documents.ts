import {
  type Database,
  documents,
  documentText,
  loadDocument,
  publishEvent,
  recordAudit,
} from '@robis/database';
import { createDocumentSchema, isUuid, updateDocumentSchema } from '@robis/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors.ts';
import {
  auditActor,
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';
import { parse } from '../validate.ts';

/**
 * REST surface for documents: create, list, rename, delete, and a read-only
 * plain-text view.
 *
 * The *content* deliberately does not go through here. Editing happens over the
 * WebSocket gateway, because a CRDT needs incremental updates against a live
 * replica -- a request/response endpoint would either force a full-document
 * round trip per keystroke or reintroduce the last-write-wins overwrite that
 * the CRDT exists to avoid.
 */
export async function documentRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  app.get(
    '/workspaces/:workspaceId/documents',
    { preHandler: [requireAuth, requireMembership(db, 'project:read')] },
    async (request) => {
      const { workspaceId } = currentMembership(request);

      const rows = await db
        .select({
          id: documents.id,
          title: documents.title,
          projectId: documents.projectId,
          createdAt: documents.createdAt,
          updatedAt: documents.updatedAt,
        })
        .from(documents)
        .where(eq(documents.workspaceId, workspaceId))
        .orderBy(desc(documents.updatedAt));

      return { documents: rows };
    },
  );

  app.post(
    '/workspaces/:workspaceId/documents',
    { preHandler: [requireAuth, requireMembership(db, 'project:create')] },
    async (request, reply) => {
      const user = currentUser(request);
      const { workspaceId } = currentMembership(request);
      const input = parse(createDocumentSchema, request.body);

      const document = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(documents)
          .values({
            workspaceId,
            projectId: input.projectId ?? null,
            title: input.title,
            createdBy: user.id,
          })
          .returning();

        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'document',
          entityId: row!.id,
          eventType: 'document.created',
          payload: { title: row!.title },
        });

        return row;
      });

      await publishEvent(db, {
        type: 'document.created',
        workspaceId,
        documentId: document!.id,
        actorId: user.id,
      });

      return reply.status(201).send({ document });
    },
  );

  app.get(
    '/workspaces/:workspaceId/documents/:documentId',
    { preHandler: [requireAuth, requireMembership(db, 'project:read')] },
    async (request) => {
      const { workspaceId } = currentMembership(request);
      const { documentId } = request.params as { documentId: string };

      const document = await loadMeta(workspaceId, documentId);

      // Rendered text, for previews and anything that cannot speak CRDT. The
      // editor ignores this and syncs over the socket instead.
      const doc = await loadDocument(db, documentId);

      return { document: { ...document, text: documentText(doc) } };
    },
  );

  app.patch(
    '/workspaces/:workspaceId/documents/:documentId',
    { preHandler: [requireAuth, requireMembership(db, 'project:update')] },
    async (request) => {
      const { workspaceId } = currentMembership(request);
      const { documentId } = request.params as { documentId: string };
      const input = parse(updateDocumentSchema, request.body);

      const before = await loadMeta(workspaceId, documentId);

      /*
       * Metadata only. The text itself changes through the realtime gateway
       * as a stream of CRDT updates, which are their own durable log; an
       * audit event per keystroke would bury everything else in the trail.
       */
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(documents)
          .set({ ...input, updatedAt: new Date() })
          .where(and(eq(documents.id, documentId), eq(documents.workspaceId, workspaceId)))
          .returning();

        if (!row) throw ApiError.notFound('Document not found');

        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'document',
          entityId: documentId,
          eventType: 'document.updated',
          payload: { from: before.title, to: row.title },
        });

        return row;
      });

      return { document: updated };
    },
  );

  app.delete(
    '/workspaces/:workspaceId/documents/:documentId',
    { preHandler: [requireAuth, requireMembership(db, 'project:delete')] },
    async (request, reply) => {
      const { workspaceId } = currentMembership(request);
      const { documentId } = request.params as { documentId: string };

      const document = await loadMeta(workspaceId, documentId);

      // The update log goes with it via ON DELETE CASCADE.
      await db.transaction(async (tx) => {
        const deleted = await tx
          .delete(documents)
          .where(and(eq(documents.id, documentId), eq(documents.workspaceId, workspaceId)))
          .returning({ id: documents.id });

        if (deleted.length === 0) throw ApiError.notFound('Document not found');

        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'document',
          entityId: documentId,
          eventType: 'document.deleted',
          payload: { title: document.title },
        });
      });

      return reply.status(204).send();
    },
  );

  /** Tenant-scoped metadata lookup. See the note on `loadProject`. */
  async function loadMeta(workspaceId: string, documentId: string) {
    if (!isUuid(documentId)) throw ApiError.notFound('Document not found');

    const [document] = await db
      .select({
        id: documents.id,
        title: documents.title,
        projectId: documents.projectId,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.workspaceId, workspaceId)))
      .limit(1);

    if (!document) throw ApiError.notFound('Document not found');
    return document;
  }
}
