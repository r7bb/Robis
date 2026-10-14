import { type Database, queueVerificationMail } from '@robis/database';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Asking for a verification email.
 *
 * Lives outside the route files because two of them need it: registration
 * starts the flow, and the account page can restart it.
 *
 * The API only queues the job. The worker issues the token, builds the link
 * from its own `WEB_ORIGIN` and sends it, so a slow or unreachable mail
 * server never holds a request open, and a failed send is retried rather
 * than lost.
 */
export type VerificationSender = (userId: string) => Promise<void>;

/**
 * A sender that never fails its caller.
 *
 * Registration must not roll back because the queue insert failed: an
 * account with an unconfirmed address is still a working account, and
 * nothing in Robis is gated on verification. So the failure is logged and
 * swallowed, and the account page can ask again.
 */
export function createVerificationSender(deps: {
  db: Database;
  log: FastifyBaseLogger;
}): VerificationSender {
  const { db, log } = deps;

  return async (userId) => {
    try {
      await queueVerificationMail(db, userId);
    } catch (error) {
      log.error({ err: error }, 'failed to queue verification mail');
    }
  };
}
