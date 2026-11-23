import { generateSessionToken, hashSessionToken } from '@robis/auth';
import {
  type Database,
  enqueue,
  recordAudit,
  STORAGE_PURGE_JOB,
  WORKSPACE_EXPORT_JOB,
  workspaceExports,
  workspaces,
} from '@robis/database';
import {
  contracts,
  EXPORT_KEEP_DAYS,
  EXPORT_LINK_MINUTES,
  type EXPORT_STATUSES,
  EXPORTS_SHOWN,
  isUuid,
  slugify,
} from '@robis/shared';
import type { MediaStorage } from '@robis/storage';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
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

/**
 * Workspace exports (C6). Asking queues a job; the file is fetched through
 * a link made on request, which is a token in the path: only its hash is
 * kept, it works for minutes, once, and only with an admin's session, so a
 * copied or logged address is no use to anyone. A ready export is kept for
 * a week and purged after that or a little after its one download. Each
 * step is in the audit trail.
 */

/** An export left pending this long is taken to have died, and no longer blocks another. */
const STALE_MS = 60 * 60 * 1000;
/** Long enough for a slow connection to finish the download before the file goes. */
const PURGE_AFTER_MS = 30 * 60 * 1000;
const KEEP_MS = EXPORT_KEEP_DAYS * 24 * 60 * 60 * 1000;
/** A link's token, as `generateSessionToken` makes it: 32 bytes, base64url. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

type Row = typeof workspaceExports.$inferSelect;
type ExportStatus = (typeof EXPORT_STATUSES)[number];

/** The status as a reader should see it: a dead build has failed, an old file is gone. */
function statusOf(row: Row, now = Date.now()): ExportStatus {
  if (row.status === 'pending' && now - row.createdAt.getTime() > STALE_MS) return 'failed';
  if (row.status === 'ready' && row.readyAt && now - row.readyAt.getTime() > KEEP_MS) {
    return 'expired';
  }
  return row.status as ExportStatus;
}

const wire = (row: Row) => {
  const status = statusOf(row);
  return {
    id: row.id,
    status,
    bytes: row.bytes,
    error:
      status === 'failed' && row.status === 'pending'
        ? 'The export did not finish. Ask for another.'
        : row.error,
    requestedBy: row.requestedBy,
    createdAt: row.createdAt,
    readyAt: row.readyAt,
    downloadedAt: row.downloadedAt,
  };
};

const fresh = () => gt(workspaceExports.readyAt, new Date(Date.now() - KEEP_MS));

export async function exportRoutes(
  app: FastifyInstance,
  opts: { db: Database; storage: MediaStorage },
) {
  const { db, storage } = opts;
  const admin = [requireAuth, requireMembership(db, 'workspace:export')];

  serve(app, contracts['exports.list'], { preHandler: admin }, async (request) => {
    const { workspaceId } = currentMembership(request);
    const rows = await db
      .select()
      .from(workspaceExports)
      .where(eq(workspaceExports.workspaceId, workspaceId))
      .orderBy(desc(workspaceExports.createdAt))
      .limit(EXPORTS_SHOWN);
    return { exports: rows.map(wire) };
  });

  serve(
    app,
    contracts['exports.create'],
    {
      preHandler: [...admin, rateLimit({ name: 'workspace-export', limit: 5, windowMs: 60_000 })],
    },
    async (request) => {
      const { workspaceId } = currentMembership(request);
      const user = currentUser(request);
      const created = await db.transaction(async (tx) => {
        // One at a time per workspace: the check and the insert under one lock.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`export:${workspaceId}`}))`);
        const [building] = await tx
          .select({ id: workspaceExports.id })
          .from(workspaceExports)
          .where(
            and(
              eq(workspaceExports.workspaceId, workspaceId),
              eq(workspaceExports.status, 'pending'),
              gt(workspaceExports.createdAt, new Date(Date.now() - STALE_MS)),
            ),
          )
          .limit(1);
        if (building) {
          throw ApiError.conflict('An export is already being built.', 'export_in_progress');
        }
        const [row] = await tx
          .insert(workspaceExports)
          .values({ workspaceId, requestedBy: user.id })
          .returning();
        await enqueue(tx, WORKSPACE_EXPORT_JOB, { exportId: row!.id });
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'workspace_export',
          entityId: row!.id,
          eventType: 'workspace.export_requested',
          payload: {},
        });
        return row!;
      });
      return { export: wire(created) };
    },
  );

  serve(
    app,
    contracts['exports.link'],
    { preHandler: [...admin, rateLimit({ name: 'export-link', limit: 10, windowMs: 60_000 })] },
    async (request, { params }) => {
      const { workspaceId } = currentMembership(request);
      const token = generateSessionToken();
      const expiresAt = new Date(Date.now() + EXPORT_LINK_MINUTES * 60_000);
      await db.transaction(async (tx) => {
        const [row] = await tx
          .update(workspaceExports)
          .set({ linkHash: hashSessionToken(token), linkExpiresAt: expiresAt })
          .where(
            and(
              eq(workspaceExports.id, params.exportId),
              eq(workspaceExports.workspaceId, workspaceId),
              eq(workspaceExports.status, 'ready'),
              fresh(),
            ),
          )
          .returning({ id: workspaceExports.id });
        if (!row) throw ApiError.notFound('No export ready to download');
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'workspace_export',
          entityId: row.id,
          eventType: 'workspace.export_link',
          payload: { expiresAt: expiresAt.toISOString() },
        });
      });
      return {
        url: `/api/workspaces/${workspaceId}/exports/${params.exportId}/download/${token}`,
        expiresAt,
      };
    },
  );

  const gone = () =>
    ApiError.notFound('This download link has been used, has expired, or never existed');

  /*
   * The download. The file is opened before the token is spent, so a
   * missing file or a storage error leaves the link to be tried again; then
   * the token is spent in the one statement that finds the export, so two
   * requests with one link cannot both get it. No HEAD: a prefetch or a
   * scanner must not spend the link, and nor may another site.
   */
  app.get(
    '/workspaces/:workspaceId/exports/:exportId/download/:token',
    { preHandler: admin, exposeHeadRoute: false },
    async (request, reply) => {
      const { workspaceId } = currentMembership(request);
      const { exportId, token } = request.params as { exportId: string; token: string };
      if (!isUuid(exportId) || !TOKEN.test(token)) throw gone();
      if (request.headers['sec-fetch-site'] === 'cross-site') throw gone();

      const matches = and(
        eq(workspaceExports.id, exportId),
        eq(workspaceExports.workspaceId, workspaceId),
        eq(workspaceExports.status, 'ready'),
        eq(workspaceExports.linkHash, hashSessionToken(token)),
        gt(workspaceExports.linkExpiresAt, new Date()),
        fresh(),
      );
      const [found] = await db
        .select({ storageKey: workspaceExports.storageKey })
        .from(workspaceExports)
        .where(matches);
      if (!found?.storageKey) throw gone();
      const object = await storage.open(found.storageKey);
      if (!object) throw ApiError.notFound('The export file is gone. Ask for another.');

      const spent = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(workspaceExports)
          .set({
            status: 'downloaded',
            downloadedAt: new Date(),
            linkHash: null,
            linkExpiresAt: null,
          })
          .where(matches)
          .returning({ storageKey: workspaceExports.storageKey });
        if (!row?.storageKey) return false;
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'workspace_export',
          entityId: exportId,
          eventType: 'workspace.export_downloaded',
          payload: {},
        });
        await enqueue(
          tx,
          STORAGE_PURGE_JOB,
          { keys: [row.storageKey] },
          { delayMs: PURGE_AFTER_MS },
        );
        return true;
      });
      if (!spent) {
        await object.stream.cancel();
        throw gone();
      }
      const [workspace] = await db
        .select({ slug: workspaces.slug })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId));
      const name = `${slugify(workspace?.slug ?? 'workspace') || 'workspace'}-export.zip`;
      return reply
        .header('content-type', 'application/zip')
        .header('content-length', String(object.size))
        .header('content-disposition', `attachment; filename="${name}"`)
        .header('cache-control', 'no-store')
        .header('x-content-type-options', 'nosniff')
        .send(object.stream);
    },
  );
}
