import { issueAuthToken, ttlMinutesFor } from '@robis/auth';
import type { Database } from '@robis/database';
import { type Mailer, verifyEmailMail } from '@robis/mailer';
import type { FastifyBaseLogger } from 'fastify';
import type { Env } from './env.ts';

/**
 * Sending a verification link.
 *
 * Lives outside the route files because two of them need it: registration
 * starts the flow, and the account page can restart it. Duplicating the token
 * issue plus the link assembly in both is how the two drift apart.
 */

/**
 * Build a link the recipient can click.
 *
 * From `WEB_ORIGIN`, never from the request's `Host` header. Trusting the
 * header would let an attacker who can reach the API request a reset for
 * someone else and have the link point at a host they control.
 */
export function linkFor(env: Env, path: string, token: string): string {
  return `${env.WEB_ORIGIN}${path}?token=${encodeURIComponent(token)}`;
}

export type VerificationSender = (userId: string, email: string) => Promise<void>;

/**
 * A sender that never fails its caller.
 *
 * Registration must not roll back because a mail provider is down: an account
 * with an unconfirmed address is still a working account, and nothing in Robis
 * is gated on verification. So the failure is logged and swallowed.
 */
export function createVerificationSender(deps: {
  db: Database;
  env: Env;
  mailer: Mailer;
  log: FastifyBaseLogger;
}): VerificationSender {
  const { db, env, mailer, log } = deps;

  return async (userId, email) => {
    try {
      const { token } = await issueAuthToken(db, userId, 'email_verification');

      await mailer.send(
        verifyEmailMail(
          email,
          linkFor(env, '/verify-email', token),
          ttlMinutesFor('email_verification'),
        ),
      );
    } catch (error) {
      log.error({ err: error }, 'failed to send verification mail');
    }
  };
}
