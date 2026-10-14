import type { SQL } from 'drizzle-orm';
import type { Executor } from './index.ts';
import { enqueue } from './queue.ts';
import { attachments } from './schema.ts';

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
  if (rows.length === 0) return 0;

  const keys = rows.map((row) => row.key);
  for (let start = 0; start < keys.length; start += PURGE_BATCH) {
    const payload: StoragePurgePayload = { keys: keys.slice(start, start + PURGE_BATCH) };
    await enqueue(tx, STORAGE_PURGE_JOB, payload);
  }
  return keys.length;
}
