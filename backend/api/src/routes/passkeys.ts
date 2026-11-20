import {
  credentialIdsOf,
  findPasskey,
  listPasskeys,
  MAX_PASSKEYS,
  markPasskeyUsed,
  passkeyCount,
  removePasskey,
  savePasskey,
  savePasskeyChallenge,
  spendSecondFactor,
  takePasskeyChallenge,
  UnreadableSecret,
  waitingSignInChallenges,
} from '@robis/auth';
import {
  type AccountEventType,
  type Database,
  recordAccountEventNow,
  users,
} from '@robis/database';
import { contracts, isUuid } from '@robis/shared';
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers';
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
import { STRIKES, WRONG_CODE_WINDOW_MS, WRONG_CODES_ALLOWED } from './two-factor.ts';

/**
 * Passkeys (C4), with @simplewebauthn/server: add one, list and remove
 * them, and sign in with one. The relying party is the web origin the app
 * is served from, so a passkey made here answers only here.
 *
 * Every passkey must verify its user (a fingerprint, face or device PIN) as
 * well as being present, so a passkey sign-in is two factors in itself:
 * something held and something known or been. It goes straight in, with no
 * code from an authenticator app after it.
 */

const RP_NAME = 'Robis';

/** The relying party, from the configured origin: never from a request's Host. */
function relyingPartyOf(env: Env) {
  const origin = env.WEB_ORIGIN;
  return { origin, rpID: new URL(origin).hostname };
}

/** Sign-in challenges waiting at once, from everyone, before asking waits a moment. */
const MAX_WAITING_SIGN_INS = 10_000;

const notAccepted = () =>
  ApiError.unauthorized('That passkey could not be used here. Try again, or use your password.');

export async function passkeyRoutes(
  app: FastifyInstance,
  opts: { db: Database; env: Env; limits: RateLimits },
) {
  const { db, env, limits } = opts;
  const rp = relyingPartyOf(env);
  const perCaller = (name: string) =>
    rateLimit({ name, limit: limits.authPerMinute, windowMs: 60_000 });
  const key = twoFactorKeyOf(env);

  /**
   * With two-factor on, adding a passkey needs a code as well as the
   * password (C4): a passkey goes straight in, so whoever adds one must
   * have both factors the account already asks for, or a stolen session
   * and password would buy a way round the code for good. Wrong codes count
   * towards the same per-account wait as everywhere else.
   */
  async function assertSecondFactor(userId: string, hasTwoFactor: boolean, code?: string) {
    if (!hasTwoFactor) return;
    if (!code) {
      throw ApiError.badRequest(
        'Two-factor sign-in is on: give a code from your app as well.',
        'code_required',
      );
    }
    if ((await strikes(app.rateStore, STRIKES, userId)).count >= WRONG_CODES_ALLOWED) {
      throw new ApiError(
        429,
        'too_many_codes',
        'Too many wrong codes. Wait a while and try again.',
      );
    }
    if (!key) throw twoFactorUnavailable();
    const used = await spendSecondFactor(db, key, userId, code).catch((error) => {
      if (error instanceof UnreadableSecret) throw twoFactorUnavailable();
      throw error;
    });
    if (!used) {
      await strike(app.rateStore, STRIKES, userId, WRONG_CODE_WINDOW_MS);
      throw ApiError.badRequest('That code did not work', 'bad_code');
    }
  }

  async function record(
    request: FastifyRequest,
    userId: string,
    type: AccountEventType,
    payload?: Record<string, unknown>,
  ) {
    try {
      await recordAccountEventNow(db, userId, type, { requestId: request.id, payload });
    } catch (error) {
      request.log.error({ err: error, type }, 'account trail: event not recorded');
    }
  }

  /**
   * Whose passkey answered a sign-in challenge, checked in full: the
   * challenge spent once, the signature, the origin, the user verified, the
   * count, and the user id the authenticator holds. One refusal for every
   * failure, so none says which part was wrong.
   */
  async function signerOf(challengeId: string, answer: AuthenticationResponseJSON) {
    const challenge = await takePasskeyChallenge(db, challengeId, 'sign_in', null);
    if (!challenge) throw notAccepted();
    const passkey = await findPasskey(db, answer.id);
    if (!passkey) throw notAccepted();

    const verified = await verifyAuthenticationResponse({
      response: answer,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: isoBase64URL.toBuffer(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports as never,
      },
    }).catch(() => null);
    if (!verified?.verified) throw notAccepted();
    // Every passkey here is discoverable, so its authenticator always says
    // whose it is: missing, unreadable or another account's is refused.
    if (handleOwner(answer.response.userHandle) !== passkey.userId) throw notAccepted();

    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name, username: users.username })
      .from(users)
      .where(and(eq(users.id, passkey.userId), eq(users.kind, 'human')))
      .limit(1);
    if (!user) throw notAccepted();
    return { user, passkey, newCounter: verified.authenticationInfo.newCounter };
  }

  serve(app, contracts['passkeys.list'], { preHandler: requireAuth }, async (request) => ({
    passkeys: await listPasskeys(db, currentUser(request).id),
  }));

  serve(
    app,
    contracts['passkeys.registerOptions'],
    { preHandler: [requireAuth, perCaller('passkey-add')] },
    async (request, { body }) => {
      const user = currentUser(request);
      await confirmPassword(db, user.id, body.password);
      await assertSecondFactor(user.id, user.hasTwoFactor, body.code);
      if ((await passkeyCount(db, user.id)) >= MAX_PASSKEYS) {
        throw ApiError.conflict(
          `An account can hold ${MAX_PASSKEYS} passkeys. Remove one to add another.`,
          'too_many_passkeys',
        );
      }
      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: rp.rpID,
        userName: user.username,
        userDisplayName: user.name,
        userID: isoUint8Array.fromUTF8String(user.id),
        attestationType: 'none',
        excludeCredentials: await credentialIdsOf(db, user.id),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      });
      const challengeId = await savePasskeyChallenge(db, 'register', options.challenge, user.id);
      return { challengeId, options: options as unknown as Record<string, unknown> };
    },
  );

  serve(
    app,
    contracts['passkeys.register'],
    { preHandler: [requireAuth, perCaller('passkey-add')] },
    async (request, { body }) => {
      const user = currentUser(request);
      const challenge = await takePasskeyChallenge(db, body.challengeId, 'register', user.id);
      if (!challenge) {
        throw ApiError.badRequest('That took too long. Start adding the passkey again.', 'expired');
      }
      const verified = await verifyRegistrationResponse({
        response: body.response as unknown as RegistrationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        requireUserVerification: true,
      }).catch(() => null);
      if (!verified?.verified) {
        throw ApiError.badRequest('That passkey could not be checked. Try again.', 'not_verified');
      }
      const { credential } = verified.registrationInfo;
      const saved = await savePasskey(db, {
        userId: user.id,
        credentialId: credential.id,
        publicKey: isoBase64URL.fromBuffer(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports,
        name: body.name,
      });
      if (!saved) throw ApiError.conflict('That passkey is already added.', 'already_added');
      await record(request, user.id, 'auth.passkey_added', { name: body.name });
      return { passkey: { id: saved.id, name: body.name } };
    },
  );

  serve(
    app,
    contracts['passkeys.remove'],
    { preHandler: [requireAuth, perCaller('passkey-remove')] },
    async (request, { params: { passkeyId } }) => {
      const user = currentUser(request);
      if (!isUuid(passkeyId) || !(await removePasskey(db, user.id, passkeyId))) {
        throw ApiError.notFound('Passkey not found');
      }
      await record(request, user.id, 'auth.passkey_removed');
      return { ok: true as const };
    },
  );

  serve(
    app,
    contracts['auth.passkeyOptions'],
    { preHandler: perCaller('passkey-sign-in') },
    async () => {
      if ((await waitingSignInChallenges(db)) >= MAX_WAITING_SIGN_INS) {
        throw new ApiError(503, 'busy', 'Too many sign-ins at once. Try again in a minute.');
      }
      // No allow-list: the passkey itself says whose it is, so nobody is
      // asked for an address and none is given away.
      const options = await generateAuthenticationOptions({
        rpID: rp.rpID,
        userVerification: 'required',
      });
      const challengeId = await savePasskeyChallenge(db, 'sign_in', options.challenge, null);
      return { challengeId, options: options as unknown as Record<string, unknown> };
    },
  );

  serve(
    app,
    contracts['auth.passkeyLogin'],
    { preHandler: perCaller('passkey-sign-in') },
    async (request, { body }, reply) => {
      const { user, passkey, newCounter } = await signerOf(
        body.challengeId,
        body.response as unknown as AuthenticationResponseJSON,
      );
      await markPasskeyUsed(db, passkey.id, newCounter);
      const answer = contracts['auth.passkeyLogin'].response.parse({ user });
      await startSession(db, env, request, reply, user.id);
      await record(request, user.id, 'auth.signed_in', { with: 'passkey' });
      return answer;
    },
  );
}

/** The account id an authenticator holds, or null when it sends none or nothing readable. */
function handleOwner(handle: string | undefined): string | null {
  if (!handle) return null;
  try {
    return isoBase64URL.toUTF8String(handle);
  } catch {
    return null;
  }
}
