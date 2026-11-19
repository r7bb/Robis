import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Authenticator app codes (C4): RFC 6238 time-based one-time passwords, the
 * scheme every authenticator app speaks. SHA-1, six digits, thirty seconds:
 * the defaults, and the only settings every app honours, so nothing else is
 * offered.
 *
 * Written here rather than taken from a package: it is an HMAC and a few
 * lines of arithmetic (RFC 4226 section 5.3), checked against the RFC's own
 * test values, and a dependency would be more code to trust than this.
 */

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

/**
 * Codes one step either side of now are taken too, so a phone whose clock
 * is a little out, or a code typed as it changed, still works. Wider would
 * give a stolen code longer to be used.
 */
export const TOTP_DRIFT_STEPS = 1;

/** 160 bits, the length RFC 4226 recommends for an HMAC-SHA-1 key. */
const SECRET_BYTES = 20;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 without padding: what authenticator apps expect. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** The inverse, forgiving of case, spaces and padding; null if not base32. */
export function base32Decode(text: string): Buffer | null {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): Buffer {
  return randomBytes(SECRET_BYTES);
}

/** The time step a moment falls in. */
export function totpStep(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);
}

/** RFC 4226 HOTP for one counter, as a zero-padded string of `digits`. */
export function hotp(secret: Uint8Array, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(message).digest();
  // Dynamic truncation: the low nibble of the last byte picks four bytes.
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** The code an app shows for `step`. */
export function totpAt(secret: Uint8Array, step: number): string {
  return hotp(secret, step);
}

/** Exactly six digits, after dropping the spaces an app may show. */
export function asTotpCode(input: string): string | null {
  const code = input.replace(/\s/g, '');
  return /^\d{6}$/.test(code) ? code : null;
}

/**
 * The step whose code `input` is, within the allowed drift, or null.
 *
 * Every candidate is compared, in constant time, whether or not an earlier
 * one matched, so how long this takes says nothing about which step it was.
 * Whether the step has been used already is the caller's question: that
 * needs the database, so one code cannot be spent twice by two requests.
 */
export function matchingStep(
  secret: Uint8Array,
  input: string,
  now: Date = new Date(),
): number | null {
  const code = asTotpCode(input);
  if (!code) return null;
  const current = totpStep(now);
  let found: number | null = null;
  for (let delta = -TOTP_DRIFT_STEPS; delta <= TOTP_DRIFT_STEPS; delta++) {
    const step = current + delta;
    const same = timingSafeEqual(Buffer.from(totpAt(secret, step)), Buffer.from(code));
    if (same && found === null) found = step;
  }
  return found;
}

/**
 * The `otpauth://` address a QR code carries, as authenticator apps read it.
 * The label shows in the app's list, so it names Robis and the username, not
 * the email address.
 */
export function otpauthUri(secret: Uint8Array, account: string, issuer = 'Robis'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
