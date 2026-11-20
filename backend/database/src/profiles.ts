import { and, eq, type SQL, sql } from 'drizzle-orm';
import { PURGE_BATCH, STORAGE_PURGE_JOB, type StoragePurgePayload } from './files.ts';
import type { Executor } from './index.ts';
import { enqueue } from './queue.ts';
import { stories, workspaceMembers } from './schema.ts';
import { deleteStories } from './stories.ts';

/**
 * Queue removal of the cover photos of the memberships `where` selects
 * (B2). Call it in the transaction that deletes them or their workspace,
 * before the delete, like `queueAttachmentPurge`: the cascade removes the
 * rows but cannot remove files.
 */
export async function queueCoverPurge(tx: Executor, where: SQL): Promise<number> {
  const rows = await tx
    .select({ key: workspaceMembers.coverKey })
    .from(workspaceMembers)
    .where(sql`${where} and ${workspaceMembers.coverKey} is not null`)
    // Locked, so a cover being replaced right now commits first and its new
    // key, not the one it replaces, is the one read here.
    .for('update');
  const keys = rows.flatMap((row) => (row.key ? [row.key] : []));
  for (let start = 0; start < keys.length; start += PURGE_BATCH) {
    const payload: StoragePurgePayload = { keys: keys.slice(start, start + PURGE_BATCH) };
    await enqueue(tx, STORAGE_PURGE_JOB, payload);
  }
  return keys.length;
}

/**
 * What goes with a person who leaves a workspace, is removed from it, or is
 * an agent taken out of it (B2): their stories there and their cover, files
 * and all. Call it before the membership row is deleted, in the same
 * transaction, so the cover's key can still be read.
 */
export async function clearMembershipMedia(
  tx: Executor,
  workspaceId: string,
  userId: string,
): Promise<void> {
  await queueCoverPurge(
    tx,
    and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))!,
  );
  await deleteStories(tx, and(eq(stories.workspaceId, workspaceId), eq(stories.authorId, userId))!);
}
