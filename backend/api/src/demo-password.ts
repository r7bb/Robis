import { DEMO_PASSWORD } from '@robis/shared';
import type { Env } from './env.ts';
import { ApiError } from './errors.ts';

/** The public demo password works in development and nowhere else. */
function demoPasswordAllowed(env: Pick<Env, 'NODE_ENV'>): boolean {
  return env.NODE_ENV === 'development';
}

export function isRefusedDemoPassword(env: Pick<Env, 'NODE_ENV'>, password: string): boolean {
  return password === DEMO_PASSWORD && !demoPasswordAllowed(env);
}

/** For any route that sets a password: sign-up, change, reset. */
export function assertPasswordAllowed(env: Pick<Env, 'NODE_ENV'>, password: string) {
  if (isRefusedDemoPassword(env, password)) {
    throw ApiError.badRequest(
      'That is the public demo password and cannot be used here. Choose another.',
      'demo_password',
    );
  }
}
