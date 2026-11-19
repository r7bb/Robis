import { parseSecretKey } from '@robis/auth';
import type { Env } from './env.ts';
import { ApiError } from './errors.ts';

/**
 * The key authenticator secrets are sealed with (C4), or null when the
 * server has none: two-factor cannot then be set up, and an account that
 * has it is refused at sign-in rather than let in on its password alone.
 */
export function twoFactorKeyOf(env: Env): Buffer | null {
  return env.TWO_FACTOR_KEY ? parseSecretKey(env.TWO_FACTOR_KEY) : null;
}

export function twoFactorUnavailable(): ApiError {
  return new ApiError(
    503,
    'two_factor_unavailable',
    'Two-factor sign-in is not set up on this server yet. Try again later, or ask whoever runs it.',
  );
}
