import { deleteExpiredAuthTokens, deleteExpiredSessions } from '@robis/auth';
import {
  type Database,
  deleteExpiredUsernameHolds,
  deleteStaleSignups,
  judgeAgentChanges,
  pruneAgentHistory,
  pruneExpiredAgentTokens,
  pruneIdempotencyLedger,
  pruneReadNotifications,
} from '@robis/database';
import { notifyHandlers } from './notify.ts';
import { scanNudges } from './nudges.ts';
import type { Handlers } from './runner.ts';

/**
 * Job handlers.
 *
 * Every one of these must be idempotent. The queue is at-least-once: a worker
 * that stalls past the visibility timeout has its job reclaimed and run again,
 * and there is no way to make delivery exactly-once without the handler's
 * cooperation.
 */

/** Delete session rows that have already expired. */
export const cleanupSessions = async (_payload: unknown, { db }: { db: Database }) => {
  await deleteExpiredSessions(db);
  // Reset and verification tokens expire the same way sessions do, and there
  // is no reason to run a second timer for the same kind of housekeeping.
  await deleteExpiredAuthTokens(db);
  // So do username holds, once their 90 days are up.
  await deleteExpiredUsernameHolds(db);
  // And sign-ups nobody finished, which would otherwise name an address forever.
  await deleteStaleSignups(db);
  // Idempotency keys past their 30-day replay window, and notifications read
  // more than 90 days ago (stage 3, item 30).
  await pruneIdempotencyLedger(db);
  await pruneReadNotifications(db);
  // And the triage agent's run tokens, a day after they expired (B5).
  await pruneExpiredAgentTokens(db);
  // Agents' runs and judged changes after 90 days, hint feedback after a year (B6).
  await pruneAgentHistory(db);
};

/** Judge agents' changes that are seven days old: kept, edited or reverted (B6). */
export const judgeAgentWork = async (_payload: unknown, { db }: { db: Database }) => {
  await judgeAgentChanges(db);
};

/** Periodic scan that decides who could use a prompt. See `nudges.ts`. */
export const runNudgeScan = async (_payload: unknown, { db }: { db: Database }) => {
  await scanNudges(db);
};

export const handlers: Handlers = {
  // Mentions, comments on your issue, assignments, meeting changes (C3).
  ...notifyHandlers,
  'sessions.cleanup': cleanupSessions,
  'nudges.scan': runNudgeScan,
  'agents.judge': judgeAgentWork,
};
