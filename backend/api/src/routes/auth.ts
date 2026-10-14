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
} from '@robis/auth';
import { type Database, users } from '@robis/database';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
  usernameProblem,
} from '@robis/shared';
import { and, eq, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { RateLimits } from '../app.ts';
import { assertPasswordAllowed, isRefusedDemoPassword } from '../demo-password.ts';
import type { Env } from '../env.ts';
import { ApiError } from '../errors.ts';
import { avatarOf } from '../media/avatars.ts';
import { currentUser, requireAuth } from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';
import { parse } from '../validate.ts';
import { createVerificationSender } from '../verification.ts';

export async function authRoutes(
  app: FastifyInstance,
  opts: { db: Database; env: Env; limits: RateLimits },
) {
  const { db, env, limits } = opts;

  const sendVerification = createVerificationSender({ db, log: app.log });

  /**
   * Verified when no user matches, so a login attempt costs the same whether or
   * not the address is registered -- otherwise response timing reveals which
   * emails have accounts. Derived from `hashPassword` rather than hardcoded, so
   * it cannot drift out of sync with the real cost parameters.
   */
  const dummyDigest = await hashPassword(randomBytes(32).toString('hex'));

  /** What an API response may say about an account. */
  const PUBLIC_USER = {
    id: users.id,
    email: users.email,
    name: users.name,
    username: users.username,
  };

  /**
   * Which unique field a failed insert hit. The email check keeps the
   * existing behaviour (sign-up has always said an address is taken); the
   * username is public within the app by design.
   */
  async function registrationConflict(email: string) {
    // Email first, in its own lookup: when both clash, the address is the
    // one the person cannot change their way out of, so it is said first.
    const [byEmail] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    return byEmail
      ? ApiError.conflict('An account with that email already exists', 'email_taken')
      : ApiError.conflict('That username is taken', 'username_taken');
  }

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
    assertPasswordAllowed(env, input.password);
    const passwordHash = await hashPassword(input.password);

    const [user] = await db
      .insert(users)
      .values({ email: input.email, name: input.name, username: input.username, passwordHash })
      // Losing the race on either unique index returns no row, which we
      // translate into the same 409 as the checked case. Doing this instead
      // of a SELECT-then-INSERT removes the race entirely.
      .onConflictDoNothing()
      .returning(PUBLIC_USER);

    if (!user) throw await registrationConflict(input.email);

    const { token, expiresAt } = await createSession(db, user.id, request.headers['user-agent']);
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });

    // Queued: one insert, so sign-up never waits on a mail server, and the
    // worker retries a failed send instead of losing the link.
    await sendVerification(user.id);

    return reply.status(201).send({ user });
  });

  app.post('/auth/login', { preHandler: credentialLimit }, async (request, reply) => {
    const input = parse(loginSchema, request.body);

    const [user] = await db
      .select({ ...PUBLIC_USER, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    // Verified first either way, so a refused demo password costs the same
    // time as a wrong one and the answer reveals nothing.
    const matches = await verifyPassword(user?.passwordHash ?? dummyDigest, input.password);
    const ok = matches && !isRefusedDemoPassword(env, input.password);

    // One message for both failure modes: a distinct "no such account" reply
    // would let anyone test whether an address is registered.
    if (!ok || !user) throw ApiError.unauthorized('Invalid email or password');

    const { token, expiresAt } = await createSession(db, user.id, request.headers['user-agent']);
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });

    return {
      user: { id: user.id, email: user.email, name: user.name, username: user.username },
    };
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
      .select({
        emailVerifiedAt: users.emailVerifiedAt,
        avatarKind: users.avatarKind,
        avatarRef: users.avatarRef,
        avatarUpdatedAt: users.avatarUpdatedAt,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    return {
      user: {
        ...user,
        emailVerified: Boolean(row?.emailVerifiedAt),
        emailVerifiedAt: row?.emailVerifiedAt ?? null,
        // Null until a picture is chosen, which is what the app's welcome
        // step checks before letting someone in.
        avatar: row ? avatarOf({ id: user.id, ...row }) : null,
      },
    };
  });

  /*
   * Renames are throttled: a username frees the moment it is changed, and an
   * account cycling through names is either a bug or someone trying to wear
   * another person's old handle.
   */
  const profileLimit = rateLimit({
    name: 'profile-update',
    limit: limits.authPerMinute,
    windowMs: 60_000,
  });

  app.patch('/auth/me', { preHandler: [requireAuth, profileLimit] }, async (request) => {
    const user = currentUser(request);
    const input = parse(updateProfileSchema, request.body);

    if (input.username && input.username !== user.username) {
      const [holder] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.username, input.username), ne(users.id, user.id)))
        .limit(1);
      if (holder) throw ApiError.conflict('That username is taken', 'username_taken');
    }

    try {
      const [updated] = await db
        .update(users)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(users.id, user.id))
        .returning(PUBLIC_USER);

      return { user: updated };
    } catch (error) {
      // Someone took the name between the check and the write; the unique
      // index decided, and the answer is the same as the checked case.
      if ((error as { code?: string }).code === '23505') {
        throw ApiError.conflict('That username is taken', 'username_taken');
      }
      throw error;
    }
  });

  /**
   * Whether a username can be had, for the sign-up and settings forms.
   *
   * Throttled like the credential routes: usernames are visible inside the
   * app anyway, but an unthrottled lookup is a cheap way to list them all.
   */
  const availabilityLimit = rateLimit({
    name: 'username-available',
    limit: limits.authPerMinute * 6,
    windowMs: 60_000,
    // By address, signed in or not: per account, a handful of fresh sign-ups
    // would each bring their own budget and multiply it.
    key: (request) => request.ip,
  });

  app.get('/auth/username-available', { preHandler: availabilityLimit }, async (request) => {
    const { username } = request.query as { username?: unknown };
    // A repeated parameter arrives as an array; anything but one string is
    // simply not a username.
    const candidate = typeof username === 'string' ? username.trim().toLowerCase() : '';

    const problem = usernameProblem(candidate);
    if (problem) return { username: candidate, available: false, reason: problem };

    const [holder] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, candidate))
      .limit(1);

    // Your own current name counts as available to you.
    const mine = holder && request.user?.id === holder.id;
    return {
      username: candidate,
      available: !holder || Boolean(mine),
      reason: holder && !mine ? 'taken' : null,
    };
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

      assertPasswordAllowed(env, input.newPassword);

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
