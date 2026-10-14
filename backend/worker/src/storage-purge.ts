import { type MediaStorage, storageFromEnv } from '@robis/api/media/storage';
import type { StoragePurgePayload } from '@robis/database';
import type { JobHandler } from './runner.ts';

/**
 * Remove stored files whose rows were deleted.
 *
 * Idempotent, as every handler must be: deleting a file that is already gone
 * is not an error in either storage driver, so a redelivered job simply does
 * nothing the second time. A failure on one key fails the job and the queue
 * retries the whole list, which is safe for the same reason.
 */
export function storagePurgeHandler(storage: MediaStorage): JobHandler {
  return async (payload) => {
    const { keys } = payload as StoragePurgePayload;
    if (!Array.isArray(keys)) throw new Error('storage.purge: keys is required');

    for (const key of keys) await storage.delete(key);
  };
}

/** The same driver the API uses, from the same environment variables. */
export function workerStorage(env: Record<string, string | undefined>): MediaStorage {
  return storageFromEnv({
    STORAGE_DRIVER: env.STORAGE_DRIVER === 's3' ? 's3' : 'local',
    MEDIA_DIR: env.MEDIA_DIR ?? '.media',
    S3_ENDPOINT: env.S3_ENDPOINT ?? '',
    S3_BUCKET: env.S3_BUCKET ?? '',
    S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID ?? '',
    S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY ?? '',
    S3_REGION: env.S3_REGION ?? 'us-east-1',
  });
}
