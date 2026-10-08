import {
  consumeAuthToken,
  hashPassword,
  issueAuthToken,
  revokeAllSessions,
  ttlMinutesFor,
} from '@relay/auth';
import { type Database, users } from '@relay/database';
import { type Mailer, passwordResetMail } from '@relay/mailer';
import { forgotPasswordSchema, resetPasswordSchema, verifyEmailSchema } from '@relay/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { RateLimits } from '../app.ts';
import type { Env } from '../env.ts';
import { ApiError } from '../errors.ts';
import { currentUser, requireAuth } from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';
import { parse } from '../validate.ts';
import { createVerificationSender, linkFor } from '../verification.ts';

/**
 * Getting back into an account, and proving an address is yours.
 *
 * Split from `auth.ts`, which had grown to hold two unrelated stories --
 * signing in, and recovering access -- in one 300-line function. These routes
 * also share a threat model the login routes do not: the secret arrives by
 * email rather than from memory, so it must be short-lived, single-use, and
 * useless to someone who merely knows the address.
 */

export type RecoveryDeps = {
  db: Database;
  env: Env;
  limits: RateLimits;
  mailer: Mailer;
};

/**
 * Minimum time the forgot-password endpoint takes to answer.
 *
 * The work for a known address (an upsert plus a send) is strictly more than
 * for an unknown one (a single select), so without a floor the response time
 * states whether the account exists. Holding every reply to the same budget
 * removes the signal however slow the mail driver is, which matters because
 * the obvious next driver is SMTP over a network.
 *
 * Long enough to cover a local send, short enough not to be felt.
 */
export const FORGOT_FLOOR_MS = 400;

export async function authRecoveryRoutes(app: FastifyInstance, opts: RecoveryDeps) {
  const { db, env, limits, mailer } = opts;

  const sendVerification = createVerificationSender({ db, env, mailer, log: app.log });

  /*
   * Each endpoint gets its own bucket.
   *
   * They previously shared one named `auth`, so a burst of reset requests
   * could lock the same address out of signing in, and behind one office NAT
   * could lock out everybody. Separate names stop one abused endpoint from
   * spending another's budget.
   */
  const perCaller = (name: string) =>
    rateLimit({ name, limit: limits.authPerMinute, windowMs: 60_000 });

  /**
   * Reset requests are also limited per *recipient*.
   *
   * A caller-keyed limit does not protect the person being mailed: the
   * attacker chooses the address, so a handful of addresses is enough to
   * flood one mailbox. This counts per address, which is the thing abused.
   */
  const perAddress = rateLimit({
    name: 'password-forgot-address',
    limit: limits.passwordForgotPerHourPerAddress,
    windowMs: 60 * 60_000,
    key: (request) => {
      const parsed = forgotPasswordSchema.safeParse(request.body);
      return parsed.success ? `email:${parsed.data.email}` : null;
    },
  });

  /**
   * Ask for a password reset link.
   *
   * Always answers 202 with the same body, whether or not the address has an
   * account and whether or not it is even a valid address. Anything else turns
   * this into an account-existence oracle for anyone holding a list of
   * addresses, which is why the schema is parsed permissively rather than
   * being allowed to 400, and why every reply waits out `FORGOT_FLOOR_MS`.
   */
  app.post(
    '/auth/password/forgot',
    { preHandler: [perCaller('password-forgot'), perAddress] },
    async (request, reply) => {
      const startedAt = Date.now();
      const parsed = forgotPasswordSchema.safeParse(request.body);

      if (parsed.success) {
        const [user] = await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(eq(users.email, parsed.data.email))
          .limit(1);

        if (user) {
          try {
            const { token } = await issueAuthToken(db, user.id, 'password_reset');

            await mailer.send(
              passwordResetMail(
                user.email,
                linkFor(env, '/reset-password', token),
                ttlMinutesFor('password_reset'),
              ),
            );
          } catch (error) {
            // Logged, never surfaced: the reply is fixed by design, and a 500
            // here would itself reveal that the address exists.
            request.log.error({ err: error }, 'failed to send password reset mail');
          }
        }
      }

      const remaining = FORGOT_FLOOR_MS - (Date.now() - startedAt);
      if (remaining > 0) await Bun.sleep(remaining);

      return reply.status(202).send({ ok: true });
    },
  );

  /**
   * Spend a reset link.
   *
   * The payload is validated before the token is touched, so mistyping the new
   * password does not burn the link. Every failure to redeem returns one
   * generic 400: distinguishing "expired" from "no such token" would confirm a
   * token once existed for that account.
   *
   * Consume, update and revoke run in one transaction. Run separately, a crash
   * between them could spend the link without changing the password, or change
   * the password while leaving an attacker's session alive.
   */
  app.post('/auth/password/reset', { preHandler: perCaller('password-reset') }, async (request) => {
    const input = parse(resetPasswordSchema, request.body);

    // Hashed before the transaction opens. Argon2 is deliberately slow, and
    // holding a transaction open across it pins a connection for no reason.
    const passwordHash = await hashPassword(input.newPassword);

    const changed = await db.transaction(async (tx) => {
      const userId = await consumeAuthToken(tx, input.token, 'password_reset');
      if (!userId) return false;

      await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));

      // Whoever did this may be recovering from a compromise, so every session
      // goes, including one an attacker is holding.
      await revokeAllSessions(tx, userId);
      return true;
    });

    if (!changed) {
      throw ApiError.badRequest('That reset link is not valid any more', 'invalid_token');
    }

    // Deliberately no session cookie: holding a mailed link is not the same
    // proof of identity as knowing the password, so the next step is signing in
    // with the new one.
    return { ok: true };
  });

  app.post('/auth/email/verify', { preHandler: perCaller('email-verify') }, async (request) => {
    const input = parse(verifyEmailSchema, request.body);

    const userId = await consumeAuthToken(db, input.token, 'email_verification');
    if (!userId) {
      throw ApiError.badRequest('That verification link is not valid any more', 'invalid_token');
    }

    await db
      .update(users)
      // An already-verified address keeps its original timestamp: the first
      // confirmation is the one that happened.
      .set({ emailVerifiedAt: new Date() })
      .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));

    return { ok: true };
  });

  app.post(
    '/auth/email/resend',
    { preHandler: [requireAuth, perCaller('email-resend')] },
    async (request) => {
      const user = currentUser(request);

      const [row] = await db
        .select({ emailVerifiedAt: users.emailVerifiedAt })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);

      // Nothing to do, and saying so is safe: the caller is the account holder.
      if (row?.emailVerifiedAt) return { ok: true, alreadyVerified: true };

      await sendVerification(user.id, user.email);
      return { ok: true, alreadyVerified: false };
    },
  );
}
