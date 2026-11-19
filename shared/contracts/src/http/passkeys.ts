import { z } from 'zod';
import { PASSWORD_MAX_LENGTH } from '../limits.ts';
import { publicUser } from './auth.ts';
import { contract, timestamp } from './contract.ts';

/**
 * Passkeys (C4): sign in with a phone, laptop or security key instead of a
 * password. Adding one asks for the password again, so a session left open
 * on someone else's computer cannot add its own. The WebAuthn options and
 * answers pass through as the browser's JSON; the server checks them.
 */

const ok = z.object({ ok: z.literal(true) });
/** The browser's JSON for a WebAuthn answer: checked in full by the server's verifier. */
const credentialAnswer = z.looseObject({
  id: z.string().min(1).max(1024),
  type: z.literal('public-key'),
});
/** WebAuthn options, as JSON for the browser to hand to the authenticator. */
const webauthnOptions = z.record(z.string(), z.unknown());
const challengeId = z.uuid();

export const passkeyContracts = {
  'passkeys.list': contract({
    method: 'GET',
    path: '/auth/passkeys',
    summary: 'Your passkeys, without their keys.',
    response: z.object({
      passkeys: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          createdAt: timestamp,
          lastUsedAt: timestamp.nullable(),
        }),
      ),
    }),
  }),
  'passkeys.registerOptions': contract({
    method: 'POST',
    path: '/auth/passkeys/options',
    summary:
      'Start adding a passkey: asks for the password again, and a code too when two-factor is on.',
    body: z.object({
      password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
      /** A code from the authenticator app, or a recovery code: needed when two-factor is on. */
      code: z.string().trim().min(1).max(40).optional(),
    }),
    response: z.object({ challengeId, options: webauthnOptions }),
  }),
  'passkeys.register': contract({
    method: 'POST',
    path: '/auth/passkeys',
    summary: 'Finish adding a passkey with the authenticator’s answer.',
    body: z.object({
      challengeId,
      name: z.string().trim().min(1).max(60),
      response: credentialAnswer,
    }),
    response: z.object({ passkey: z.object({ id: z.string(), name: z.string() }) }),
  }),
  'passkeys.remove': contract({
    method: 'DELETE',
    path: '/auth/passkeys/:passkeyId',
    summary: 'Remove one of your passkeys.',
    params: z.object({ passkeyId: z.string() }),
    response: ok,
  }),
  'auth.passkeyOptions': contract({
    method: 'POST',
    path: '/auth/passkey/options',
    summary: 'Start signing in with a passkey: a challenge for any of them to answer.',
    response: z.object({ challengeId, options: webauthnOptions }),
  }),
  'auth.passkeyLogin': contract({
    method: 'POST',
    path: '/auth/passkey',
    summary: 'Sign in with a passkey’s answer; the session is a cookie.',
    body: z.object({ challengeId, response: credentialAnswer }),
    response: z.object({ user: publicUser }),
  }),
};
