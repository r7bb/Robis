import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Sealing the authenticator secrets (C4) at rest.
 *
 * Unlike a password or a token, a TOTP secret cannot be stored as a hash:
 * checking a code needs the secret itself. So it is encrypted with
 * AES-256-GCM under a key the server is given (`TWO_FACTOR_KEY`) and never
 * keeps in the database, and a copy of the database alone yields no
 * secrets. The account id is bound in as associated data, so a sealed
 * secret copied onto another account's row does not open.
 */

const VERSION = 'v1';
const KEY_BYTES = 32;
const IV_BYTES = 12;

/** 32 bytes, written as base64 or base64url; null for anything else. */
export function parseSecretKey(text: string): Buffer | null {
  const trimmed = text.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) return null;
  const key = Buffer.from(trimmed.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return key.length === KEY_BYTES ? key : null;
}

/** A fresh key, as `bun run two-factor:key` prints it. */
export function newSecretKey(): string {
  return randomBytes(KEY_BYTES).toString('base64url');
}

export function sealSecret(key: Buffer, secret: Uint8Array, boundTo: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(boundTo));
  const body = Buffer.concat([cipher.update(secret), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, body, tag]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

/**
 * The secret, or null when it does not open: a different key, a different
 * account, or a value altered at rest. Null, never a throw, so a bad row is
 * a refused code rather than a crash; the caller logs it.
 */
export function openSecret(key: Buffer, sealed: string, boundTo: string): Buffer | null {
  const [version, iv, body, tag] = sealed.split('.');
  if (version !== VERSION || !iv || !body || !tag) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(boundTo));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]);
  } catch {
    return null;
  }
}
