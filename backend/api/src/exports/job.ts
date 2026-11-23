import {
  type Database,
  enqueue,
  notify,
  recordAudit,
  STORAGE_PURGE_JOB,
  type WorkspaceExportPayload,
  workspaceExports,
  workspaces,
} from '@robis/database';
import { EXPORT_KEEP_DAYS } from '@robis/shared';
import type { MediaStorage } from '@robis/storage';
import { and, eq } from 'drizzle-orm';
import { buildExport, ExportTooLarge } from './build.ts';

/**
 * Build one export (C6), store it, mark it ready and tell whoever asked.
 * Safe to run twice at once, as a job reclaimed mid-build may be: each run
 * writes its own file, only the first to finish marks the export ready,
 * and a run that loses removes the file it wrote. A ready file is purged
 * once the keeping window ends, downloaded or not.
 */

const KEEP_MS = EXPORT_KEEP_DAYS * 24 * 60 * 60 * 1000;

const exportKey = (workspaceId: string, exportId: string) =>
  `exports/${workspaceId}/${exportId}-${crypto.randomUUID()}.zip`;

const SYSTEM = { id: null, kind: 'system' as const };

export async function runExportJob(db: Database, storage: MediaStorage, payload: unknown) {
  const { exportId } = payload as WorkspaceExportPayload;
  if (typeof exportId !== 'string') throw new Error('workspace.export: exportId is required');
  const [row] = await db.select().from(workspaceExports).where(eq(workspaceExports.id, exportId));
  if (row?.status !== 'pending') return;

  let built: Awaited<ReturnType<typeof buildExport>>;
  try {
    built = await buildExport(db, storage, row.workspaceId);
  } catch (error) {
    if (!(error instanceof ExportTooLarge)) throw error;
    await db
      .update(workspaceExports)
      .set({ status: 'failed', error: error.message })
      .where(and(eq(workspaceExports.id, exportId), eq(workspaceExports.status, 'pending')));
    return;
  }

  const key = exportKey(row.workspaceId, exportId);
  await storage.put(key, built.bytes, 'application/zip');
  const won = await db.transaction(async (tx) => {
    const [ready] = await tx
      .update(workspaceExports)
      .set({ status: 'ready', storageKey: key, bytes: built.bytes.byteLength, readyAt: new Date() })
      .where(and(eq(workspaceExports.id, exportId), eq(workspaceExports.status, 'pending')))
      .returning({ id: workspaceExports.id });
    if (!ready) return false;
    await enqueue(tx, STORAGE_PURGE_JOB, { keys: [key] }, { delayMs: KEEP_MS });
    await recordAudit(tx, SYSTEM, {
      workspaceId: row.workspaceId,
      entityType: 'workspace_export',
      entityId: exportId,
      eventType: 'workspace.export_ready',
      payload: { bytes: built.bytes.byteLength, counts: built.counts },
    });
    if (!row.requestedBy) return true;
    const [workspace] = await tx
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, row.workspaceId));
    await notify(tx, [
      {
        userId: row.requestedBy,
        workspaceId: row.workspaceId,
        actorId: null,
        kind: 'export',
        entityType: 'workspace_export',
        entityId: exportId,
        dedupeKey: `export:${exportId}`,
        payload: { workspaceName: workspace?.name ?? '' },
      },
    ]);
    return true;
  });
  if (!won) await storage.delete(key);
}
