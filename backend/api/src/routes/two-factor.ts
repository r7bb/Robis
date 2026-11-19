import {
  base32Encode,
  confirmTwoFactor,
  disableTwoFactor,
  endChallenge,
  finishChallenge,
  hasTwoFactor,
  otpauthUri,
  replaceRecoveryCodes,
  reserveTry,
  SIGN_IN_CHALLENGE_ATTEMPTS,
  spendSecondFactor,
  startTwoFactorSetup,
  twoFactorState,
  UnreadableSecret,
} from '@robis/auth';
import {
  type AccountEventType,
  type Database,
  recordAccountEventNow,
  users,
} from '@robis/database';
import { contracts } from '@robis/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RateLimits } from '../app.ts';
import { confirmPassword } from '../confirm-password.ts';
import { serve } from '../contract.ts';
import type { Env } from '../env.ts';
import { ApiError } from '../errors.ts';
import { currentUser, requireAuth } from '../plugins/authz.ts';
import { rateLimit, strike, strikes } from '../plugins/rate-limit.ts';
import { startSession } from '../session-cookie.ts';
import { twoFactorKeyOf, twoFactorUnavailable } from '../two-factor-key.ts';

/** Wrong codes against one sign-in within this window are one history entry. */
const FAILED_CODE_WINDOW_MS = 5 * 60_000;

/**
 * Wrong codes one account may have in a window, from anywhere, before it
 * waits: per account, as the address can be changed and the code cannot be
 * guessed faster than this. A wait, not a lock: it ends on its own.
 */
const WRONG_CODES_ALLOWED = 10;
const WRONG_CODE_WINDOW_MS = 15 * 60_000;
const STRIKES = 'two-factor-wrong-codes';

/**
 * Two-factor sign-in with an authenticator app (C4): set up, turned on with
 * a first code, new recovery codes, turned off, and the second step of a
 * sign-in. Every change asks for the password again, and turning it off or
 * replacing the codes asks for a code too, so an open session on a borrowed
 * computer cannot undo it.
 */
export async function twoFactorRoutes(
  app: FastifyInstance,
  opts: { db: Database; env: Env; limits: RateLimits },
) {
  const { db, env, limits } = opts;
  const key = twoFactorKeyOf(env);

  // Codes and passwords are guessable things: each try counts, per caller.
  const codeLimit = rateLimit({
    name: 'two-factor',
    limit: limits.authPerMinute,
    windowMs: 60_000,
  });
  const guarded = { preHandler: [requireAuth, codeLimit] };

  /** The event, without letting a failure to write it fail what already happened. */
  async function record(
    request: FastifyRequest,
    userId: string,
    type: AccountEventType,
    extra: { payload?: Record<string, unknown>; coalesceWithinMs?: number } = {},
  ) {
    try {
      await recordAccountEventNow(db, userId, type, { requestId: request.id, ...extra });
    } catch (error) {
      request.log.error({ err: error, type }, 'account trail: event not recorded');
    }
  }

  function needKey(): Buffer {
    if (!key) throw twoFactorUnavailable();
    return key;
  }

  /** Refuse before checking a code when the account has had too many wrong ones. */
  function assertNotWaiting(userId: string) {
    const { count, resetInSeconds } = strikes(STRIKES, userId);
    if (count < WRONG_CODES_ALLOWED) return;
    const minutes = Math.max(1, Math.ceil(resetInSeconds / 60));
    throw new ApiError(
      429,
      'too_many_codes',
      `Too many wrong codes for this account. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
    );
  }

  /** A second step spent, or a refusal; a secret that will not open is the server's fault. */
  async function spend(userId: string, code: string) {
    assertNotWaiting(userId);
    try {
      const used = await spendSecondFactor(db, needKey(), userId, code);
      if (!used) strike(STRIKES, userId, WRONG_CODE_WINDOW_MS);
      return used;
    } catch (error) {
      if (error instanceof UnreadableSecret) {
        app.log.error({ userId }, 'two-factor secret does not open with TWO_FACTOR_KEY');
        throw twoFactorUnavailable();
      }
      throw error;
    }
  }

  /** A wrong code against a sign-in: counted, recorded, and said with the tries left. */
  async function wrongCode(
    request: FastifyRequest,
    userId: string,
    challenge: string,
    attempt: number,
  ) {
    const left = SIGN_IN_CHALLENGE_ATTEMPTS - attempt;
    if (left <= 0) await endChallenge(db, challenge);
    await record(request, userId, 'auth.two_factor_failed', {
      coalesceWithinMs: FAILED_CODE_WINDOW_MS,
    });
    if (left === 0) {
      return new ApiError(
        401,
        'challenge_spent',
        'That code did not work either; start again with your password',
      );
    }
    return new ApiError(
      401,
      'bad_code',
      `That code did not work; ${left} ${left === 1 ? 'try' : 'tries'} left`,
    );
  }

  /** The person a sign-in is for, as the answer shows them. */
  async function personOf(userId: string) {
    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name, username: users.username })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.kind, 'human')))
      .limit(1);
    return user ?? null;
  }

  serve(app, contracts['twoFactor.state'], { preHandler: requireAuth }, async (request) => {
    const state = await twoFactorState(db, currentUser(request).id);
    return { available: key !== null, ...state };
  });

  serve(app, contracts['twoFactor.setup'], guarded, async (request, { body }) => {
    const user = currentUser(request);
    const sealWith = needKey();
    await confirmPassword(db, user.id, body.password);
    const secret = await startTwoFactorSetup(db, sealWith, user.id);
    if (!secret) {
      throw ApiError.conflict('Two-factor sign-in is already on; turn it off first', 'already_on');
    }
    return { secret: base32Encode(secret), uri: otpauthUri(secret, user.username) };
  });

  serve(app, contracts['twoFactor.enable'], guarded, async (request, { body }) => {
    const user = currentUser(request);
    let codes: string[] | null;
    try {
      codes = await confirmTwoFactor(db, needKey(), user.id, body.code);
    } catch (error) {
      if (error instanceof UnreadableSecret) throw twoFactorUnavailable();
      throw error;
    }
    if (!codes) {
      throw ApiError.badRequest(
        'That code did not match. Check the app shows Robis, and type the code it shows now.',
        'bad_code',
      );
    }
    await record(request, user.id, 'auth.two_factor_enabled');
    return { recoveryCodes: codes };
  });

  serve(app, contracts['twoFactor.recoveryCodes'], guarded, async (request, { body }) => {
    const user = currentUser(request);
    await confirmPassword(db, user.id, body.password);
    if (!(await hasTwoFactor(db, user.id))) {
      throw ApiError.conflict('Two-factor sign-in is not on', 'not_on');
    }
    if (!(await spend(user.id, body.code))) {
      await record(request, user.id, 'auth.two_factor_failed', {
        coalesceWithinMs: FAILED_CODE_WINDOW_MS,
      });
      throw ApiError.badRequest('That code did not work', 'bad_code');
    }
    // In one transaction: never a moment with no codes, or two sets.
    const codes = await db.transaction((tx) => replaceRecoveryCodes(tx, user.id));
    await record(request, user.id, 'auth.recovery_codes_replaced');
    return { recoveryCodes: codes };
  });

  serve(app, contracts['twoFactor.disable'], guarded, async (request, { body }) => {
    const user = currentUser(request);
    await confirmPassword(db, user.id, body.password);
    if (!(await hasTwoFactor(db, user.id))) {
      throw ApiError.conflict('Two-factor sign-in is not on', 'not_on');
    }
    if (!(await spend(user.id, body.code))) {
      await record(request, user.id, 'auth.two_factor_failed', {
        coalesceWithinMs: FAILED_CODE_WINDOW_MS,
      });
      throw ApiError.badRequest('That code did not work', 'bad_code');
    }
    await disableTwoFactor(db, user.id);
    await record(request, user.id, 'auth.two_factor_disabled');
    return { ok: true as const };
  });

  // The second step of a sign-in: no session until a code is right.
  serve(
    app,
    contracts['auth.loginTwoFactor'],
    { preHandler: codeLimit },
    async (request, { body }, reply) => {
      const expired = () =>
        ApiError.unauthorized('This sign-in has run out of time; start again with your password');
      const reserved = await reserveTry(db, body.challenge);
      if (!reserved) throw expired();
      const { userId } = reserved;

      const used = await spend(userId, body.code);
      if (!used) throw await wrongCode(request, userId, body.challenge, reserved.attempt);

      // The delete is the check: of two finishing at once, one is let in.
      if ((await finishChallenge(db, body.challenge)) !== userId) throw expired();
      const user = await personOf(userId);
      if (!user) throw expired();

      const answer = contracts['auth.loginTwoFactor'].response.parse({ user });
      await startSession(db, env, request, reply, user.id);
      await record(request, user.id, 'auth.signed_in', { payload: { secondStep: used } });
      if (used === 'recovery') await record(request, user.id, 'auth.recovery_code_used');
      return answer;
    },
  );
}
