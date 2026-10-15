import { statSync, writeFileSync } from 'node:fs';

/**
 * Liveness for a process with no port.
 *
 * The worker serves nothing, so a container health check cannot ask it over
 * HTTP. Instead it touches a file after every poll that reached the queue,
 * and the check reads how old that file is. A stalled loop or an unreachable
 * database both stop the touches, and the container goes unhealthy.
 */

/** Polls happen every second when idle; this is many missed ones. */
export const HEARTBEAT_MAX_AGE_MS = 30_000;

export const DEFAULT_HEARTBEAT_FILE = '/tmp/robis-worker-heartbeat';

/** Writes are cheap but not free; one a second is plenty. */
const MIN_WRITE_GAP_MS = 1_000;

export function heartbeat(path: string, now: () => number = Date.now): () => void {
  let lastWrite = 0;
  return () => {
    const at = now();
    if (at - lastWrite < MIN_WRITE_GAP_MS) return;
    lastWrite = at;
    try {
      writeFileSync(path, String(at));
    } catch (error) {
      // A full or read-only disk is worth saying, not worth stopping work for.
      console.error('worker: heartbeat not written', error);
    }
  };
}

/** True when the file was touched within `maxAgeMs`. A missing file is not alive. */
export function isAlive(
  path: string,
  maxAgeMs = HEARTBEAT_MAX_AGE_MS,
  now: number = Date.now(),
): boolean {
  try {
    return now - statSync(path).mtimeMs <= maxAgeMs;
  } catch {
    return false;
  }
}
