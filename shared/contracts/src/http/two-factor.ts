import { z } from 'zod';
import { PASSWORD_MAX_LENGTH } from '../limits.ts';
import { contract, timestamp } from './contract.ts';

/**
 * Two-factor sign-in with an authenticator app (C4): set up, turned on with
 * a first code, turned off, new recovery codes, and the second step of a
 * sign-in. Changing any of it asks for the password again, and turning it
 * off or replacing the recovery codes asks for a code too, so a session
 * left open on someone else's computer cannot undo it.
 */

const password = z.string().min(1).max(PASSWORD_MAX_LENGTH);
/** Six digits from the app, or a recovery code; read by its shape. */
const code = z.string().trim().min(1).max(40);
const recoveryCodes = z.object({
  /** Shown once: only their hashes are kept. */
  recoveryCodes: z.array(z.string()),
});
const ok = z.object({ ok: z.literal(true) });

export const twoFactorContracts = {
  'twoFactor.state': contract({
    method: 'GET',
    path: '/auth/two-factor',
    summary: 'Whether two-factor sign-in is on, and how many recovery codes are left.',
    response: z.object({
      /** False when this server has no key to keep secrets with; nothing can be set up. */
      available: z.boolean(),
      enabled: z.boolean(),
      confirmedAt: timestamp.nullable(),
      recoveryCodesLeft: z.number().int(),
    }),
  }),
  'twoFactor.setup': contract({
    method: 'POST',
    path: '/auth/two-factor/setup',
    summary: 'Start setting up an authenticator app: a new secret, shown once.',
    body: z.object({ password }),
    response: z.object({
      /** Base32, for typing into an app by hand. */
      secret: z.string(),
      /** The `otpauth://` address the QR code carries. */
      uri: z.string(),
    }),
  }),
  'twoFactor.enable': contract({
    method: 'POST',
    path: '/auth/two-factor/enable',
    summary: 'Turn two-factor on with a first code from the app; answers with recovery codes.',
    body: z.object({ code }),
    response: recoveryCodes,
  }),
  'twoFactor.recoveryCodes': contract({
    method: 'POST',
    path: '/auth/two-factor/recovery-codes',
    summary: 'Replace every recovery code with a new set.',
    body: z.object({ password, code }),
    response: recoveryCodes,
  }),
  'twoFactor.disable': contract({
    method: 'POST',
    path: '/auth/two-factor/disable',
    summary: 'Turn two-factor off.',
    body: z.object({ password, code }),
    response: ok,
  }),
} as const;
