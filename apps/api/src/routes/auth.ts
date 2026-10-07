import { randomBytes } from 'node:crypto';
import {
  createSession,
  hashPassword,
  listSessions,
  revokeAllSessions,
  revokeAuthTokens,
  revokeOtherSessions,
  revokeSession,
  SESSION_COOKIE,
  verifyPassword,
} from '@relay/auth';
import { type Database, users } from '@relay/database';
import type { Mailer } from '@relay/mailer';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from '@relay/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { RateLimits } from '../app.ts';
import type { Env } from '../env.ts';
import { ApiError } from '../errors.ts';
import { currentUser, requireAuth } from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';
import { parse } from '../validate.ts';
import { createVerificationSender } from '../verification.ts';

export async function authRoutes(
  app: FastifyInstance,
  opts: { db: Database; env: Env; limits: RateLimits; mailer: Mailer },
) {
  const { db, env, limits, mailer } = opts;

  const sendVerification = createVerificationSender({ db, env, mailer, log: app.log });

  /**
   * Verified when no user matches, so a login attempt costs the same whether or
   * not the address is registered -- otherwise response timing reveals which
   * emails have accounts. Derived from `hashPassword` rather than hardcoded, so
   * it cannot drift out of sync with the real cost parameters.
   */
  const dummyDigest = await hashPassword(randomBytes(32).toString('hex'));

  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.COOKIE_SECURE,
    path: '/',
  };

  /*
   * Credential endpoints are throttled per address. Argon2 makes each attempt
   * expensive by design, which protects the password but also makes this a
   * cheap way to burn server CPU -- the limit protects the server.
   */
  const credentialLimit = rateLimit({
    name: 'auth',
    limit: limits.authPerMinute,
    windowMs: 60_000,
  });

  app.post('/auth/register', { preHandler: credentialLimit }, async (request, reply) => {
    const input = parse(registerSchema, request.body);
    const passwordHash = await hashPassword(input.password);

    const [user] = await db
      .insert(users)
      .values({ email: input.email, name: input.name, passwordHash })
      // Losing the race on the unique index returns no row, which we translate
      // into the same 409 as the checked case. Doing this instead of a
      // SELECT-then-INSERT removes the race entirely.
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id, email: users.email, name: users.name });

    if (!user) throw ApiError.conflict('An account with that email already exists', 'email_taken');

    const { token, expiresAt } = await createSession(db, user.id, request.headers['user-agent']);
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });

    /*
     * Awaited, deliberately.
     *
     * Not awaiting would keep sign-up fast against a slow provider, which is
     * the right shape eventually. It is wrong today for two reasons: the only
     * driver writes to a local stream, so there is nothing to wait for, and a
     * detached promise makes "did the new account get its link" unobservable
     * to the caller and to tests.
     *
     * When a real driver lands this should become a queued job rather than a
     * detached promise -- the queue already exists, and it gives retries and
     * visibility that `void` does not.
     */
    await sendVerification(user.id, user.email);

    return reply.status(201).send({ user });
  });

  app.post('/auth/login', { preHandler: credentialLimit }, async (request, reply) => {
    const input = parse(loginSchema, request.body);

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    const ok = await verifyPassword(user?.passwordHash ?? dummyDigest, input.password);

    // One message for both failure modes: a distinct "no such account" reply
    // would let anyone test whether an address is registered.
    if (!ok || !user) throw ApiError.unauthorized('Invalid email or password');

    const { token, expiresAt } = await createSession(db, user.id, request.headers['user-agent']);
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });

    return { user: { id: user.id, email: user.email, name: user.name } };
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await revokeSession(db, token);

    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return { ok: true };
  });

  /**
   * Who the caller is.
   *
   * Verification status is read here rather than carried on the session,
   * because the session row is resolved on every authenticated request and the
   * gateway shares that path -- paying for an extra column everywhere to serve
   * one rarely-hit endpoint is the wrong trade. This is one indexed lookup by
   * primary key.
   */
  app.get('/auth/me', { preHandler: requireAuth }, async (request) => {
    const user = currentUser(request);

    const [row] = await db
      .select({ emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    return {
      user: {
        ...user,
        emailVerified: Boolean(row?.emailVerifiedAt),
        emailVerifiedAt: row?.emailVerifiedAt ?? null,
      },
    };
  });

  app.patch('/auth/me', { preHandler: requireAuth }, async (request) => {
    const user = currentUser(request);
    const input = parse(updateProfileSchema, request.body);

    const [updated] = await db
      .update(users)
      .set({ name: input.name })
      .where(eq(users.id, user.id))
      .returning({ id: users.id, email: users.email, name: users.name });

    return { user: updated };
  });

  /**
   * Change password.
   *
   * Throttled with the same budget as login, because it verifies a password
   * and is therefore the same CPU cost to an attacker.
   *
   * Every session is revoked and a new one issued for the caller. Sparing the
   * current session would be friendlier, but someone changing their password
   * because a device was stolen expects that device to be signed out -- and if
   * the current token is the leaked one, sparing it defeats the exercise.
   */
  app.post(
    '/auth/password',
    { preHandler: [requireAuth, credentialLimit] },
    async (request, reply) => {
      const user = currentUser(request);
      const input = parse(changePasswordSchema, request.body);

      const [row] = await db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);

      if (!row) throw ApiError.unauthorized('Not signed in');

      if (!(await verifyPassword(row.passwordHash, input.currentPassword))) {
        throw ApiError.badRequest('Current password is incorrect', 'bad_password');
      }

      // Rejected before hashing, since a no-op change would revoke every
      // session for nothing.
      if (await verifyPassword(row.passwordHash, input.newPassword)) {
        throw ApiError.badRequest('New password must differ from the current one', 'same_password');
      }

      await db
        .update(users)
        .set({ passwordHash: await hashPassword(input.newPassword) })
        .where(eq(users.id, user.id));

      await revokeAllSessions(db, user.id);

      // Someone changing their password because their mailbox was exposed
      // still has a live reset link until it expires. Retire it here, or the
      // change they just made can be undone by an old email.
      await revokeAuthTokens(db, user.id, 'password_reset');

      const { token, expiresAt } = await createSession(db, user.id, request.headers['user-agent']);
      reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });

      return { ok: true };
    },
  );

  app.get('/auth/sessions', { preHandler: requireAuth }, async (request) => {
    const user = currentUser(request);
    // `requireAuth` passed, so a cookie is present.
    const token = request.cookies[SESSION_COOKIE]!;

    return { sessions: await listSessions(db, user.id, token) };
  });

  app.delete('/auth/sessions', { preHandler: requireAuth }, async (request) => {
    const user = currentUser(request);
    const token = request.cookies[SESSION_COOKIE]!;

    return { revoked: await revokeOtherSessions(db, user.id, token) };
  });
}
