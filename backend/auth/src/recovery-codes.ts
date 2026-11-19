import { randomInt } from 'node:crypto';
import { hashSessionToken } from './tokens.ts';

/**
 * Recovery codes (C4): the way in when the phone with the authenticator is
 * lost. Ten per account, each working once, stored only as a hash.
 *
 * Sixteen characters from Crockford's base32 alphabet, which leaves out the
 * letters that pass for digits, so a code copied by hand off paper still
 * works: 80 random bits each. That is enough that plain SHA-256 is the right
 * hash, as for session tokens: there is nothing to guess, so a slow hash
 * would cost every sign-in and protect nothing.
 */

export const RECOVERY_CODE_COUNT = 10;

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LENGTH = 16;
const GROUP = 4;

/** One code as it is shown: four groups of four, `7K3M-...`. */
function newCode(): string {
  let raw = '';
  for (let i = 0; i < LENGTH; i++) raw += ALPHABET[randomInt(ALPHABET.length)];
  return raw.match(new RegExp(`.{${GROUP}}`, 'g'))!.join('-');
}

export function newRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, newCode);
}

/**
 * The code as it is compared: upper case, without dashes or spaces, and
 * with the look-alikes read as Crockford reads them (O as 0, I and L as 1).
 * Null when what is left is not a code at all, so a typo costs no lookup.
 */
export function normaliseRecoveryCode(input: string): string | null {
  const clean = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (clean.length !== LENGTH) return null;
  for (const char of clean) if (!ALPHABET.includes(char)) return null;
  return clean;
}

/** The hash a code is stored and looked up by. */
export function hashRecoveryCode(normalised: string): string {
  return hashSessionToken(`recovery:${normalised}`);
}
