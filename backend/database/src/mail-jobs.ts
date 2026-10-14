import type { Executor } from './index.ts';
import { jobs } from './schema.ts';

/**
 * Account mail, sent from the job queue.
 *
 * A job names the account and what to send, never the message itself. The
 * worker issues the token and builds the link at send time, so a reset link
 * is never written to the jobs table -- and so never left there in a dead
 * letter -- while tokens everywhere else are stored only as a hash.
 *
 * At most one is waiting per account and kind (`jobs_pending_mail_once`).
 * Asking again while one is queued, backing off or being sent adds nothing:
 * the waiting job will deliver a link, and a second send would only replace
 * that link with another and put two emails in the inbox.
 */
export const MAIL_PASSWORD_RESET_JOB = 'mail.password_reset';
export const MAIL_EMAIL_VERIFICATION_JOB = 'mail.email_verification';

export const MAIL_JOBS = [MAIL_PASSWORD_RESET_JOB, MAIL_EMAIL_VERIFICATION_JOB] as const;

export type AccountMailPayload = { userId: string };

/**
 * Retries with backoff, then a dead letter: a dead provider is visible, not
 * silent. Ten attempts back off for about seventeen minutes in all, which
 * rides out a short provider outage; a reset link lives thirty.
 */
const MAIL_ATTEMPTS = 10;

async function queueAccountMail(db: Executor, kind: string, userId: string) {
  const payload: AccountMailPayload = { userId };
  await db
    .insert(jobs)
    // From this process's clock, as `enqueue` does: claiming compares against
    // the same clock, so a job is due the moment it is queued.
    .values({
      kind,
      payload: JSON.stringify(payload),
      runAt: new Date(),
      maxAttempts: MAIL_ATTEMPTS,
    })
    .onConflictDoNothing();
}

export function queuePasswordResetMail(db: Executor, userId: string) {
  return queueAccountMail(db, MAIL_PASSWORD_RESET_JOB, userId);
}

export function queueVerificationMail(db: Executor, userId: string) {
  return queueAccountMail(db, MAIL_EMAIL_VERIFICATION_JOB, userId);
}
