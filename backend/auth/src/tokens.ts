import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'robis_session';

/**
 * The production name. With the `__Host-` prefix the browser itself insists
 * the cookie is Secure, has `Path=/` and no `Domain`, so no subdomain and no
 * plain-http page can set or overwrite a session for this host.
 */
export const HOST_SESSION_COOKIE = '__Host-robis_session';

export function sessionCookieName(nodeEnv: string): string {
  return nodeEnv === 'production' ? HOST_SESSION_COOKIE : SESSION_COOKIE;
}

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * A session left unused this long ends, however long it had to live: a
 * forgotten laptop should not stay signed in for a month.
 */
export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Sessions use a 256-bit random token rather than a signed JWT. The token is
 * the only secret; it is never stored, only its SHA-256.
 *
 * Plain SHA-256 (not Argon2) is correct here: the input is already high-entropy
 * random, so there is nothing to brute-force, and session lookup happens on
 * every request where a 20ms KDF would be a real cost.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

/** Constant-time comparison for any secret compared outside the database. */
export function sessionExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + SESSION_TTL_MS);
}
