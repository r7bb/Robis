import type { SQL } from 'drizzle-orm';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { Executor } from './index.ts';
import { enqueue } from './queue.ts';
import { attachments, messages, posts, stories, workspaceExports } from './schema.ts';

/** The job that removes stored files whose rows are gone. */
export const STORAGE_PURGE_JOB = 'storage.purge';

/**
 * Keys per job. A workspace delete can free thousands of files; one job
 * holding them all could outlast its claim and be retried from the start
 * until it ran out of attempts. Small jobs finish, and fail independently.
 */
export const PURGE_BATCH = 100;

export type StoragePurgePayload = { keys: string[] };

/**
 * Queue removal of the files behind the attachments `where` selects.
 *
 * Call it inside the transaction that deletes their parent (an issue, a
 * comment, a workspace), before the delete: the cascade removes the rows but
 * cannot remove files, and reading the keys afterwards would find nothing.
 * Enqueued in the same transaction, so a rolled-back delete queues nothing
 * and a committed one cannot forget its files.
 */
export async function queueAttachmentPurge(tx: Executor, where: SQL): Promise<number> {
  const rows = await tx.select({ key: attachments.storageKey }).from(attachments).where(where);
  return queueKeysPurge(
    tx,
    rows.map((row) => row.key),
  );
}

/**
 * Queue removal of these stored files, in batches, in the caller's
 * transaction: the one place every kind of file (attachments, stories,
 * covers, chat pictures) goes through once its row is going.
 */
export async function queueKeysPurge(tx: Executor, keys: readonly string[]): Promise<number> {
  for (let start = 0; start < keys.length; start += PURGE_BATCH) {
    const payload: StoragePurgePayload = { keys: keys.slice(start, start + PURGE_BATCH) };
    await enqueue(tx, STORAGE_PURGE_JOB, payload);
  }
  return keys.length;
}

/**
 * Queue removal of the pictures on the messages `where` selects (B2): for a
 * message taken down, a room deleted, or a workspace deleted, before the
 * delete, like `queueAttachmentPurge`.
 */
export async function queueMessageImagePurge(tx: Executor, where: SQL): Promise<number> {
  const rows = await tx
    .select({ key: messages.imageKey })
    .from(messages)
    .where(sql`${where} and ${messages.imageKey} is not null`);
  return queueKeysPurge(
    tx,
    rows.flatMap((row) => (row.key ? [row.key] : [])),
  );
}

/** Queue removal of the photos on the feed posts `where` selects (Phase 2c), before the delete. */
export async function queuePostPhotoPurge(tx: Executor, where: SQL): Promise<number> {
  const rows = await tx
    .select({ key: posts.photoKey })
    .from(posts)
    .where(sql`${where} and ${posts.photoKey} is not null`);
  return queueKeysPurge(
    tx,
    rows.flatMap((row) => (row.key ? [row.key] : [])),
  );
}

/**
 * How much a workspace may store (stage 1, item 11), in bytes. Checked
 * before an upload is read; shown to the workspace's owners.
 */
export const WORKSPACE_STORAGE_QUOTA_BYTES = 1024 ** 3;

/** Bytes a workspace's files take, as stored: images on issues, story photos, chat pictures (B2) and feed photos. */
export async function workspaceStorageUsed(db: Executor, workspaceId: string): Promise<number> {
  const [row] = await db
    .select({
      used: sql<number>`coalesce((select sum(${attachments.bytes}) from ${attachments} where ${attachments.workspaceId} = ${workspaceId}), 0)::bigint
        + coalesce((select sum(${stories.bytes}) from ${stories} where ${stories.workspaceId} = ${workspaceId}), 0)::bigint
        + coalesce((select sum(${messages.imageBytes}) from ${messages} where ${messages.workspaceId} = ${workspaceId}), 0)::bigint
        + coalesce((select sum(${posts.photoBytes}) from ${posts} where ${posts.workspaceId} = ${workspaceId}), 0)::bigint`,
    })
    .from(sql`(select 1) as one`);
  return Number(row?.used ?? 0);
}

/**
 * Queue removal of a workspace's export files (C6), before the workspace is
 * deleted: an export holds everything the workspace did, so it must not
 * outlive it in storage once its row has cascaded away.
 */
export async function queueExportPurge(tx: Executor, workspaceId: string): Promise<number> {
  const rows = await tx
    .select({ key: workspaceExports.storageKey })
    .from(workspaceExports)
    .where(
      and(eq(workspaceExports.workspaceId, workspaceId), isNotNull(workspaceExports.storageKey)),
    );
  return queueKeysPurge(
    tx,
    rows.flatMap((row) => (row.key ? [row.key] : [])),
  );
}
