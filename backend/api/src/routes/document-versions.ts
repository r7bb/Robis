import {
  type Database,
  documents,
  documentText,
  documentVersions,
  loadDocument,
  recordVersion,
} from '@robis/database';
import { contracts, isUuid } from '@robis/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import { currentMembership, requireAuth, requireMembership } from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';

/** How much of a version the list shows. */
const PREVIEW_LENGTH = 160;
/** Versions a person may keep by hand in a minute (each before a restore). */
const KEEPS_PER_MINUTE = 10;

/**
 * History: the versions the live gateway kept of a document, for anyone who
 * may read it. Nothing here changes a document: putting a version back
 * happens in the editor, as an ordinary edit everyone sees, after the text
 * it replaces is kept as a version (keepVersion), so a restore can be undone.
 */
export async function documentVersionRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;
  const keepLimit = rateLimit({ name: 'document-keep', limit: KEEPS_PER_MINUTE, windowMs: 60_000 });

  async function assertDocument(workspaceId: string, documentId: string) {
    if (!isUuid(documentId)) throw ApiError.notFound('Document not found');
    const [row] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.workspaceId, workspaceId)));
    if (!row) throw ApiError.notFound('Document not found');
  }

  serve(
    app,
    contracts['documents.versions'],
    { preHandler: [requireAuth, requireMembership(db, 'project:read')] },
    async (request, { params: { documentId } }) => {
      await assertDocument(currentMembership(request).workspaceId, documentId);
      const rows = await db
        .select({
          id: documentVersions.id,
          createdAt: documentVersions.createdAt,
          preview: sql<string>`left(${documentVersions.text}, ${PREVIEW_LENGTH})`,
          length: sql<number>`length(${documentVersions.text})::int`,
        })
        .from(documentVersions)
        .where(eq(documentVersions.documentId, documentId))
        .orderBy(desc(documentVersions.createdAt));
      return { versions: rows };
    },
  );

  serve(
    app,
    contracts['documents.keepVersion'],
    { preHandler: [requireAuth, requireMembership(db, 'project:read'), keepLimit] },
    async (request, { params: { documentId } }) => {
      await assertDocument(currentMembership(request).workspaceId, documentId);
      // As the server holds it now: what everyone sees, not what one tab says.
      const text = documentText(await loadDocument(db, documentId));
      const kept = await recordVersion(db, documentId, text, new Date(), { whatever: true });
      return { kept };
    },
  );

  serve(
    app,
    contracts['documents.version'],
    { preHandler: [requireAuth, requireMembership(db, 'project:read')] },
    async (request, { params: { documentId, versionId } }) => {
      await assertDocument(currentMembership(request).workspaceId, documentId);
      if (!isUuid(versionId)) throw ApiError.notFound('Version not found');
      const [version] = await db
        .select({
          id: documentVersions.id,
          createdAt: documentVersions.createdAt,
          text: documentVersions.text,
        })
        .from(documentVersions)
        .where(
          and(eq(documentVersions.id, versionId), eq(documentVersions.documentId, documentId)),
        );
      if (!version) throw ApiError.notFound('Version not found');
      return { version };
    },
  );
}
