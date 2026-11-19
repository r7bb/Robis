import { describe, expect, test } from 'bun:test';
import {
  base32Decode,
  base32Encode,
  hashRecoveryCode,
  hotp,
  matchingStep,
  newRecoveryCodes,
  newSecretKey,
  newTotpSecret,
  normaliseRecoveryCode,
  openSecret,
  otpauthUri,
  parseSecretKey,
  sealSecret,
  TOTP_PERIOD_SECONDS,
  totpAt,
  totpStep,
} from '@robis/auth';

/** The secret in RFC 4226 appendix D and RFC 6238 appendix B. */
const RFC_SECRET = Buffer.from('12345678901234567890');

describe('authenticator codes', () => {
  test('match the HOTP values in RFC 4226', () => {
    const expected = [
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ];
    expect(expected.map((_, counter) => hotp(RFC_SECRET, counter))).toEqual(expected);
  });

  test('match the TOTP values in RFC 6238 (SHA-1)', () => {
    const cases: [number, string][] = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];
    for (const [seconds, code] of cases) {
      const step = totpStep(new Date(seconds * 1000));
      expect(hotp(RFC_SECRET, step, 8)).toBe(code);
    }
  });

  test('a code is taken one step either side of now and no further', () => {
    const secret = newTotpSecret();
    const now = new Date();
    const step = totpStep(now);

    expect(matchingStep(secret, totpAt(secret, step), now)).toBe(step);
    expect(matchingStep(secret, totpAt(secret, step - 1), now)).toBe(step - 1);
    expect(matchingStep(secret, totpAt(secret, step + 1), now)).toBe(step + 1);
    // Unless two windows happen to share a code, which is one in a million.
    if (totpAt(secret, step - 2) !== totpAt(secret, step)) {
      expect(matchingStep(secret, totpAt(secret, step - 2), now)).toBeNull();
    }
    const later = new Date(now.getTime() + 2 * TOTP_PERIOD_SECONDS * 1000);
    expect(matchingStep(secret, totpAt(secret, step), later)).toBeNull();
  });

  test('only six digits count as a code; spaces are dropped', () => {
    const secret = newTotpSecret();
    const now = new Date();
    const code = totpAt(secret, totpStep(now));

    expect(matchingStep(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now)).toBe(totpStep(now));
    expect(matchingStep(secret, `${code}0`, now)).toBeNull();
    expect(matchingStep(secret, code.slice(1), now)).toBeNull();
    expect(matchingStep(secret, 'abcdef', now)).toBeNull();
    expect(matchingStep(secret, '', now)).toBeNull();
  });

  test('base32 goes there and back, and refuses what is not base32', () => {
    const secret = newTotpSecret();
    const text = base32Encode(secret);
    expect(text).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(text)?.equals(secret)).toBe(true);
    expect(base32Decode(text.toLowerCase())?.equals(secret)).toBe(true);
    // RFC 4648 section 10.
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('not base32!')).toBeNull();
  });

  test('the otpauth address names Robis and the username and carries the secret', () => {
    const secret = newTotpSecret();
    const uri = new URL(otpauthUri(secret, 'ada'));

    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/Robis:ada');
    expect(uri.searchParams.get('secret')).toBe(base32Encode(secret));
    expect(uri.searchParams.get('issuer')).toBe('Robis');
    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('period')).toBe('30');
  });
});

describe('sealed secrets', () => {
  const key = parseSecretKey(newSecretKey())!;

  test('open with the same key and account, and only then', () => {
    const secret = newTotpSecret();
    const sealed = sealSecret(key, secret, 'user-a');

    expect(sealed).not.toContain(base32Encode(secret));
    expect(openSecret(key, sealed, 'user-a')?.equals(secret)).toBe(true);
    expect(openSecret(key, sealed, 'user-b')).toBeNull();
    expect(openSecret(parseSecretKey(newSecretKey())!, sealed, 'user-a')).toBeNull();
  });

  test('an altered value does not open', () => {
    const sealed = sealSecret(key, newTotpSecret(), 'user-a');
    const [version, iv, body, tag] = sealed.split('.');
    const flipped = Buffer.from(body!, 'base64url');
    flipped[0] = flipped[0]! ^ 1;

    expect(
      openSecret(key, [version, iv, flipped.toString('base64url'), tag].join('.'), 'user-a'),
    ).toBeNull();
    expect(openSecret(key, 'garbage', 'user-a')).toBeNull();
    expect(openSecret(key, `v2.${iv}.${body}.${tag}`, 'user-a')).toBeNull();
  });

  test('a key must be 32 bytes of base64', () => {
    expect(parseSecretKey(newSecretKey())).toHaveLength(32);
    expect(parseSecretKey(Buffer.alloc(32, 1).toString('base64'))).toHaveLength(32);
    expect(parseSecretKey(Buffer.alloc(16, 1).toString('base64'))).toBeNull();
    expect(parseSecretKey('not a key')).toBeNull();
    expect(parseSecretKey('')).toBeNull();
  });
});

describe('recovery codes', () => {
  test('ten different codes of four groups of four', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes)
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
  });

  test('typed loosely they still read as the same code', () => {
    const [code] = newRecoveryCodes(1);
    const normal = normaliseRecoveryCode(code!)!;

    expect(normaliseRecoveryCode(code!.toLowerCase())).toBe(normal);
    expect(normaliseRecoveryCode(code!.replace(/-/g, ' '))).toBe(normal);
    expect(normaliseRecoveryCode('O1IL-0000-0000-0000')).toBe('0111000000000000');
    expect(hashRecoveryCode(normal)).toBe(
      hashRecoveryCode(normaliseRecoveryCode(code!.toLowerCase())!),
    );
  });

  test('anything else is not a code', () => {
    expect(normaliseRecoveryCode('123456')).toBeNull();
    expect(normaliseRecoveryCode('UUUU-UUUU-UUUU-UUUU')).toBeNull();
    expect(normaliseRecoveryCode('')).toBeNull();
  });
});
