import { and, eq, isNotNull, lt, or } from 'drizzle-orm';
import type { Executor } from './index.ts';
import { agentTokens, mutations, notifications } from './schema.ts';

/**
 * How long things are kept (stage 3, item 30), removed by the worker's
 * hourly cleanup.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long an Idempotency-Key replays its stored response. A client retrying
 * a mutation does so within seconds, or after coming back online: thirty
 * days covers a long offline spell with room to spare. After that the key is
 * forgotten, and the same key would be treated as new.
 */
export const IDEMPOTENCY_REPLAY_DAYS = 30;

/** How long a notification is kept once it has been read. Unread ones stay. */
export const NOTIFICATION_RETENTION_DAYS = 90;

/** Forget idempotency keys older than the replay window. Returns how many. */
export async function pruneIdempotencyLedger(db: Executor, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - IDEMPOTENCY_REPLAY_DAYS * DAY_MS);
  const removed = await db
    .delete(mutations)
    .where(lt(mutations.createdAt, before))
    .returning({ key: mutations.key });
  return removed.length;
}

/**
 * Remove notifications read more than the retention period ago, and those
 * never shown in the inbox (C3) once as old: nobody can read one of those,
 * so its age is its only clock. Returns how many.
 */
export async function pruneReadNotifications(db: Executor, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * DAY_MS);
  const removed = await db
    .delete(notifications)
    .where(
      or(
        and(isNotNull(notifications.readAt), lt(notifications.readAt, before)),
        and(eq(notifications.inApp, false), lt(notifications.createdAt, before)),
      ),
    )
    .returning({ id: notifications.id });
  return removed.length;
}

/** How long an expired agent token is kept, so its last use can still be seen. */
export const EXPIRED_AGENT_TOKEN_DAYS = 1;

/**
 * Remove agent tokens that expired over a day ago (B5): the triage agent
 * mints one per run, which would otherwise pile up one row per issue.
 * Tokens without an expiry stay until an admin removes their agent.
 */
export async function pruneExpiredAgentTokens(db: Executor, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - EXPIRED_AGENT_TOKEN_DAYS * DAY_MS);
  const removed = await db
    .delete(agentTokens)
    .where(and(isNotNull(agentTokens.expiresAt), lt(agentTokens.expiresAt, before)))
    .returning({ id: agentTokens.id });
  return removed.length;
}
