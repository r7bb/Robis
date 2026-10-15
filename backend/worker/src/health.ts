/**
 * The worker container's health check: exit 0 if the loop polled recently.
 * See `heartbeat.ts`.
 */
import { DEFAULT_HEARTBEAT_FILE, isAlive } from './heartbeat.ts';

process.exit(isAlive(process.env.WORKER_HEARTBEAT_FILE ?? DEFAULT_HEARTBEAT_FILE) ? 0 : 1);
