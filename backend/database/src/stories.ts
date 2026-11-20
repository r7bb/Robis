import { lte, type SQL, sql } from 'drizzle-orm';
import { publishEvent } from './events.ts';
import { PURGE_BATCH, STORAGE_PURGE_JOB, type StoragePurgePayload } from './files.ts';
import type { Database, Executor } from './index.ts';
import { enqueue } from './queue.ts';
import { stories } from './schema.ts';

/** How long a story is seen for (B2). */
export const STORY_TTL_MS = 24 * 60 * 60 * 1000;

/** The job that deletes stories past their 24 hours, with their files. */
export const STORY_EXPIRY_JOB = 'stories.expire';

/** How often that job runs. A story is hidden at its hour regardless. */
export const STORY_EXPIRY_INTERVAL_MS = 10 * 60 * 1000;

/** Stories deleted per pass, so one pass never holds a long transaction. */
const EXPIRY_BATCH = 500;

/**
 * Queue removal of the files behind the stories `where` selects.
 *
 * Like `queueAttachmentPurge`: call it in the transaction that deletes the
 * stories or their parent, before the delete, so a rolled-back delete
 * queues nothing and a committed one cannot forget its files.
 */
export async function queueStoryPurge(tx: Executor, where: SQL): Promise<number> {
  const rows = await tx
    .select({ key: stories.storageKey })
    .from(stories)
    .where(sql`${where} and ${stories.storageKey} is not null`);
  const keys = rows.map((row) => row.key!).filter(Boolean);
  for (let start = 0; start < keys.length; start += PURGE_BATCH) {
    const payload: StoragePurgePayload = { keys: keys.slice(start, start + PURGE_BATCH) };
    await enqueue(tx, STORAGE_PURGE_JOB, payload);
  }
  return keys.length;
}

/**
 * Delete the stories `where` selects, with their files queued for removal
 * in the same transaction: for a person who leaves a workspace, is removed
 * from it, or deletes their account, whose stories go with them.
 */
export async function deleteStories(tx: Executor, where: SQL): Promise<number> {
  await queueStoryPurge(tx, where);
  const deleted = await tx.delete(stories).where(where).returning({ id: stories.id });
  return deleted.length;
}

/**
 * Delete stories whose 24 hours are up, and queue their files (B2).
 *
 * One transaction per batch: the rows go, the purge job for their files is
 * queued, and each workspace's bars are told to re-read, together or not
 * at all. Safe to run twice, as the queue may: a second pass finds nothing.
 * Judged by the database's clock, the one every read uses, so a worker
 * whose clock runs ahead never deletes a story the API still shows.
 * Returns how many stories went.
 */
export async function expireStories(db: Database): Promise<number> {
  let total = 0;
  for (;;) {
    const gone = await db.transaction(async (tx) => {
      const due = tx
        .select({ id: stories.id })
        .from(stories)
        .where(lte(stories.expiresAt, sql`now()`))
        .limit(EXPIRY_BATCH);
      const deleted = await tx
        .delete(stories)
        .where(sql`${stories.id} in ${due}`)
        .returning({ workspaceId: stories.workspaceId, storageKey: stories.storageKey });

      const keys = deleted.flatMap((row) => (row.storageKey ? [row.storageKey] : []));
      for (let start = 0; start < keys.length; start += PURGE_BATCH) {
        const payload: StoragePurgePayload = { keys: keys.slice(start, start + PURGE_BATCH) };
        await enqueue(tx, STORAGE_PURGE_JOB, payload);
      }
      for (const workspaceId of new Set(deleted.map((row) => row.workspaceId))) {
        await publishEvent(tx, {
          type: 'story.changed',
          workspaceId,
          storyId: null,
          actorId: null,
        });
      }
      return deleted.length;
    });
    total += gone;
    if (gone < EXPIRY_BATCH) return total;
  }
}
