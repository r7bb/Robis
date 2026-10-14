import { issueAuthToken, ttlMinutesFor } from '@robis/auth';
import {
  type AccountMailPayload,
  MAIL_EMAIL_VERIFICATION_JOB,
  MAIL_PASSWORD_RESET_JOB,
  users,
} from '@robis/database';
import { linkFor, type Mailer, passwordResetMail, verifyEmailMail } from '@robis/mailer';
import { eq } from 'drizzle-orm';
import type { Handlers } from './runner.ts';

/**
 * The origin every mailed link starts with.
 *
 * The same rule the API applies to `WEB_ORIGIN`: in production it must be
 * https, because a reset link over plain http hands the token to anyone on
 * the path. Outside production it defaults to the local web app.
 */
export function mailOriginFromEnv(env: { NODE_ENV?: string; WEB_ORIGIN?: string }): string {
  const origin = env.WEB_ORIGIN?.trim() || 'http://localhost:3000';
  if (env.NODE_ENV === 'production' && !origin.startsWith('https://')) {
    throw new Error(`WEB_ORIGIN must be an https origin in production; got "${origin}".`);
  }
  return origin.replace(/\/+$/, '');
}

/**
 * Sending account mail.
 *
 * Each job carries only an account id. The token is issued here, at send
 * time, which also means a retry sends a fresh link: issuing replaces the
 * previous token for that purpose.
 *
 * The cost of that, stated: if a server accepts a message and the reply is
 * then lost, the retry delivers a second email and the first one's link no
 * longer works. The newest email always does, and the reset page says to
 * ask again. Storing the link so a retry could resend the same one would put
 * a live credential in the jobs table, which is the thing this avoids.
 */
export function mailHandlers(deps: { mailer: Mailer; webOrigin: string }): Handlers {
  const { mailer, webOrigin } = deps;

  return {
    [MAIL_PASSWORD_RESET_JOB]: async (payload, { db }) => {
      const { userId } = payload as AccountMailPayload;
      const [user] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      // The account is gone: there is no one to send it to, and retrying will
      // never change that.
      if (!user) return;

      const { token } = await issueAuthToken(db, userId, 'password_reset');
      await mailer.send(
        passwordResetMail(
          user.email,
          linkFor(webOrigin, '/reset-password', token),
          ttlMinutesFor('password_reset'),
        ),
      );
    },

    [MAIL_EMAIL_VERIFICATION_JOB]: async (payload, { db }) => {
      const { userId } = payload as AccountMailPayload;
      const [user] = await db
        .select({ email: users.email, verifiedAt: users.emailVerifiedAt })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      // Gone, or confirmed since this was queued: nothing left to ask.
      if (!user || user.verifiedAt) return;

      const { token } = await issueAuthToken(db, userId, 'email_verification');
      await mailer.send(
        verifyEmailMail(
          user.email,
          linkFor(webOrigin, '/verify-email', token),
          ttlMinutesFor('email_verification'),
        ),
      );
    },
  };
}
