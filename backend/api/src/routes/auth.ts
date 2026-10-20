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
import {
  type AccountEventOptions,
  type AccountEventType,
  canHoldAnother,
  type Database,
  deferAccountEvent,
  lockUsername,
  recordAccountEvent,
  recordAccountEventNow,
  releaseUsername,
  type Tx,
  usernameClaim,
  users,
} from '@robis/database';
import {
  changePasswordSchema,
  loginSchema,
  MAX_USERNAME_HOLDS,
  registerSchema,
  TERMS_VERSION,
  updateProfileSchema,
  usernameProblem,
} from '@robis/shared';
import { eq, sql } from 'drizzle-orm';
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

/** Failed sign-ins for one account within this window are one history entry. */
const FAILED_SIGN_IN_WINDOW_MS = 5 * 60_000;

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

  /**
   * Record an account event without letting a failure to record it fail
   * the request. The change it describes (a session made or revoked, a
   * password changed) has already happened; answering 500 would tell the
   * person it had not. A miss is logged instead.
   */
  async function recordAccountEventSafely(
    userId: string,
    eventType: AccountEventType,
    options: AccountEventOptions,
  ) {
    try {
      await recordAccountEventNow(db, userId, eventType, options);
    } catch (error) {
      app.log.error({ err: error, eventType }, 'account trail: event not recorded');
    }
  }

  /**
   * Record a failed sign-in after the reply has gone.
   *
   * Only an existing account has a trail to write to, so writing before the
   * reply would make a wrong password for a real address slower to refuse
   * than any password for an unknown one: an existence oracle. Written
   * afterwards, the reply takes the same time either way.
   */
  function recordFailedSignInLater(userId: string, requestId: string) {
    deferAccountEvent(
      db,
      userId,
      'auth.sign_in_failed',
      // A burst of guesses is one entry, not hundreds.
      { requestId, coalesceWithinMs: FAILED_SIGN_IN_WINDOW_MS },
      (error) => app.log.error({ err: error }, 'account trail: failed sign-in not recorded'),
    );
  }

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

  const termsChanged = () =>
    ApiError.conflict(
      'The terms changed while this page was open; reload to see them',
      'terms_changed',
    );

  const usernameHeld = () =>
    ApiError.conflict(
      'That username was let go recently, and is held for its last owner for now',
      'username_held',
    );

  /**
   * Lock both names' keys, then refuse the new one if someone else has or
   * holds it, or if this account already holds as many old names as it may.
   */
  async function assertCanRename(tx: Tx, userId: string, previous: string, next: string) {
    await lockUsername(tx, previous, next);
    const claim = await usernameClaim(tx, next, userId);
    if (claim === 'taken') throw ApiError.conflict('That username is taken', 'username_taken');
    if (claim === 'held') throw usernameHeld();
    if (!(await canHoldAnother(tx, userId, next))) {
      throw ApiError.conflict(
        `You can hold ${MAX_USERNAME_HOLDS} old usernames at a time; one frees up when its 90 days end`,
        'too_many_renames',
      );
    }
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
    // The form showed terms that have since changed: agreeing to those is
    // not agreeing to these, so the page is asked to reload first.
    if (input.termsVersion !== undefined && input.termsVersion !== TERMS_VERSION) {
      throw termsChanged();
    }
    const agreed = input.termsVersion === TERMS_VERSION;
    assertPasswordAllowed(env, input.password);
    const passwordHash = await hashPassword(input.password);

    const user = await db.transaction(async (tx) => {
      // A held name is refused here; a taken one (or a lookalike of one) is
      // left to the unique indexes below, which cannot lose a race.
      await lockUsername(tx, input.username);
      if ((await usernameClaim(tx, input.username, null)) === 'held') return 'held' as const;

      const [row] = await tx
        .insert(users)
        .values({
          email: input.email,
          name: input.name,
          username: input.username,
          passwordHash,
          // The name was chosen on this form.
          usernameConfirmedAt: sql`now()`,
          // Agreed just now, but only if the form said which terms it showed;
          // a client that did not is asked on its first visit instead.
          ...(agreed
            ? {
                ageConfirmedAt: sql`now()`,
                termsVersion: TERMS_VERSION,
                termsAcceptedAt: sql`now()`,
              }
            : {}),
        })
        // Losing the race on any unique index returns no row, which we
        // translate into the same 409 as the checked case. Doing this instead
        // of a SELECT-then-INSERT removes the race entirely.
        .onConflictDoNothing()
        .returning(PUBLIC_USER);
      if (row && agreed) {
        await recordAccountEvent(tx, row.id, 'auth.terms_accepted', {
          payload: { termsVersion: TERMS_VERSION },
          requestId: request.id,
        });
      }
      return row ?? null;
    });

    if (user === 'held') {
      // The address is still said first when it is taken too.
      const conflict = await registrationConflict(input.email);
      throw conflict.code === 'email_taken' ? conflict : usernameHeld();
    }
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
    if (!ok || !user) {
      if (user) recordFailedSignInLater(user.id, request.id);
      throw ApiError.unauthorized('Invalid email or password');
    }

    const { token, expiresAt } = await createSession(db, user.id, request.headers['user-agent']);
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });
    await recordAccountEventSafely(user.id, 'auth.signed_in', { requestId: request.id });

    return {
      user: { id: user.id, email: user.email, name: user.name, username: user.username },
    };
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await revokeSession(db, token);
    if (request.user) {
      await recordAccountEventSafely(request.user.id, 'auth.signed_out', {
        requestId: request.id,
      });
    }

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
        termsVersion: users.termsVersion,
        usernameConfirmedAt: users.usernameConfirmedAt,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    const { hasAvatar: _picture, hasAgreed: _agreed, ...profile } = user;
    return {
      user: {
        ...profile,
        // What the app asks before anything else, and what it already has.
        consent: {
          needed: row?.termsVersion !== TERMS_VERSION,
          termsVersion: row?.termsVersion ?? null,
          current: TERMS_VERSION,
        },
        usernameConfirmed: Boolean(row?.usernameConfirmedAt),
        emailVerified: Boolean(row?.emailVerifiedAt),
        emailVerifiedAt: row?.emailVerifiedAt ?? null,
        // Null until a picture is chosen, which is what the app's welcome
        // step checks before letting someone in.
        avatar: row ? avatarOf({ id: user.id, ...row }) : null,
      },
    };
  });

  /*
   * Renames are throttled: an account cycling through names is either a bug
   * or someone trying to wear another person's old handle, and each rename
   * holds a name for 90 days.
   */
  const profileLimit = rateLimit({
    name: 'profile-update',
    limit: limits.authPerMinute,
    windowMs: 60_000,
  });

  app.patch('/auth/me', { preHandler: [requireAuth, profileLimit] }, async (request) => {
    const user = currentUser(request);
    const input = parse(updateProfileSchema, request.body);

    try {
      const updated = await db.transaction(async (tx) => {
        // The current name, read under a row lock: two renames at once must
        // not both release the same old name.
        const [current] = await tx
          .select({ username: users.username })
          .from(users)
          .where(eq(users.id, user.id))
          .for('update');
        const previous = current?.username ?? user.username;
        const next = input.username;
        const renaming = next !== undefined && next !== previous;

        if (renaming) await assertCanRename(tx, user.id, previous, next!);

        const [row] = await tx
          .update(users)
          // Choosing a new name is confirming one.
          .set({
            ...input,
            ...(renaming ? { usernameConfirmedAt: new Date() } : {}),
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id))
          .returning(PUBLIC_USER);

        if (renaming) {
          await releaseUsername(tx, user.id, previous, next!);
          // That it happened, not the names: the history table holds those,
          // for as long as the hold lasts.
          await recordAccountEvent(tx, user.id, 'auth.username_changed', {
            requestId: request.id,
          });
        }
        return row;
      });

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

    // Your own current name, in any spelling, counts as available to you,
    // and so does a name of yours that is being held.
    const claim = await usernameClaim(db, candidate, request.user?.id ?? null);
    return {
      username: candidate,
      available: claim === 'free',
      reason: claim === 'free' ? null : claim,
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
      await recordAccountEventSafely(user.id, 'auth.password_changed', {
        requestId: request.id,
      });

      return { ok: true };
    },
  );

  app.get('/auth/sessions', { preHandler: requireAuth }, async (request) => {
    const user = currentUser(request);
    // `requireAuth` passed, so a cookie is present.
    const token = request.cookies[SESSION_COOKIE]!;

    return { sessions: await listSessions(db, user.id, token) };
  });

  app.delete('/auth/sessions', { preHandler: [requireAuth, profileLimit] }, async (request) => {
    const user = currentUser(request);
    const token = request.cookies[SESSION_COOKIE]!;

    const revoked = await revokeOtherSessions(db, user.id, token);
    // Nothing signed out, nothing to record.
    if (revoked > 0) {
      await recordAccountEventSafely(user.id, 'auth.sessions_revoked', {
        requestId: request.id,
        payload: { count: revoked },
      });
    }
    return { revoked };
  });
}
