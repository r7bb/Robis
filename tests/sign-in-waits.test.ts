import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  ADDRESS_FAILURES_PER_HOUR,
  clearSignInFailures,
  FIRST_SIGN_IN_WAIT_MS,
  FREE_SIGN_IN_FAILURES,
  MAX_SIGN_IN_WAIT_MS,
  networkOf,
  recordSignInAttempt,
  signInWaitFor,
  waitAfter,
} from '@robis/api/sign-in-waits';
import { ACTOR_PASSWORD, closeHarness, createActor, request, resetDatabase } from './harness.ts';

/**
 * Growing waits after failed sign-ins (C4). Done when: a few wrong
 * passwords cost nothing, then each doubles the wait up to a ceiling, a
 * guess during the wait is refused unchecked, and an address with no
 * account is answered just the same.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const login = (email: string, password: string) =>
  request('/auth/login', { method: 'POST', payload: { email, password } });

async function failTimes(email: string, times: number) {
  for (let i = 0; i < times; i++) {
    expect((await login(email, 'not-the-password')).statusCode).toBe(401);
  }
}

describe('the waits themselves', () => {
  const HERE = '203.0.113.7';
  const fail = (address: string, times: number, at: number, place = HERE) => {
    for (let i = 0; i < times; i++) recordSignInAttempt(address, place, at);
  };

  test('none while free, then doubling from the first, never past the ceiling', () => {
    expect(waitAfter(FREE_SIGN_IN_FAILURES - 1)).toBe(0);
    expect(waitAfter(FREE_SIGN_IN_FAILURES)).toBe(FIRST_SIGN_IN_WAIT_MS);
    expect(waitAfter(FREE_SIGN_IN_FAILURES + 1)).toBe(FIRST_SIGN_IN_WAIT_MS * 2);
    expect(waitAfter(FREE_SIGN_IN_FAILURES + 2)).toBe(FIRST_SIGN_IN_WAIT_MS * 4);
    expect(waitAfter(FREE_SIGN_IN_FAILURES + 40)).toBe(MAX_SIGN_IN_WAIT_MS);
  });

  test('run from the last failure, and are the same however the address is typed', () => {
    const start = 1_000_000;
    fail('Sam@Example.test', FREE_SIGN_IN_FAILURES, start);
    expect(signInWaitFor('sam@example.test ', HERE, start)).toBe(FIRST_SIGN_IN_WAIT_MS);
    expect(signInWaitFor('sam@example.test', HERE, start + FIRST_SIGN_IN_WAIT_MS)).toBe(0);
    clearSignInFailures('SAM@example.test');
    expect(signInWaitFor('sam@example.test', HERE, start)).toBe(0);
  });

  test('wrong passwords from one place do not hold up the owner elsewhere', () => {
    const start = 3_000_000;
    fail('owner@example.test', FREE_SIGN_IN_FAILURES + 10, start, '198.51.100.9');
    expect(signInWaitFor('owner@example.test', '198.51.100.9', start)).toBe(MAX_SIGN_IN_WAIT_MS);
    expect(signInWaitFor('owner@example.test', HERE, start)).toBe(0);
  });

  test('past the cap from everywhere in an hour, every place waits for the hour', () => {
    const start = 4_000_000;
    for (let i = 0; i < ADDRESS_FAILURES_PER_HOUR; i++) {
      recordSignInAttempt('spread@example.test', `10.0.${i >> 8}.${i & 255}`, start);
    }
    expect(signInWaitFor('spread@example.test', HERE, start)).toBe(60 * 60_000);
    expect(signInWaitFor('spread@example.test', HERE, start + 60 * 60_000 + 1)).toBe(0);
  });

  test('the cap from everywhere starts afresh each hour, so it never goes stale', () => {
    const start = 5_000_000;
    const spread = (at: number, from: number) => {
      for (let i = 0; i < ADDRESS_FAILURES_PER_HOUR; i++) {
        recordSignInAttempt(
          'again@example.test',
          `10.1.${(from + i) >> 8}.${(from + i) & 255}`,
          at,
        );
      }
    };
    spread(start, 0);
    const nextHour = start + 60 * 60_000 + 1;
    expect(signInWaitFor('again@example.test', HERE, nextHour)).toBe(0);
    spread(nextHour, 1000);
    expect(signInWaitFor('again@example.test', HERE, nextHour)).toBe(60 * 60_000);
  });

  test('IPv6 addresses in one /64 are one place', () => {
    expect(networkOf('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(networkOf('2001:0db8:0001:0002:ffff:1:2:3')).toBe('2001:db8:1:2::/64');
    expect(networkOf('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(networkOf('192.0.2.1')).toBe('192.0.2.1');
    const start = 6_000_000;
    for (let i = 0; i < FREE_SIGN_IN_FAILURES; i++) {
      recordSignInAttempt('six@example.test', `2001:db8:1:2::${i + 1}`, start);
    }
    expect(signInWaitFor('six@example.test', '2001:db8:1:2::99', start)).toBe(
      FIRST_SIGN_IN_WAIT_MS,
    );
    expect(signInWaitFor('six@example.test', '2001:db8:1:3::1', start)).toBe(0);
  });

  test('forget failures after an hour, the count starting again', () => {
    const start = 2_000_000;
    fail('old@example.test', FREE_SIGN_IN_FAILURES, start);
    const later = start + 61 * 60_000;
    fail('old@example.test', FREE_SIGN_IN_FAILURES - 1, later);
    expect(signInWaitFor('old@example.test', HERE, later)).toBe(0);
    fail('old@example.test', 1, later);
    expect(signInWaitFor('old@example.test', HERE, later)).toBe(FIRST_SIGN_IN_WAIT_MS);
  });
});

describe('signing in', () => {
  test('after the free wrong passwords, the next try waits, even with the right one', async () => {
    const actor = await createActor('Sam');
    await failTimes(actor.email, FREE_SIGN_IN_FAILURES);

    const refused = await login(actor.email, ACTOR_PASSWORD);
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error).toBe('sign_in_wait');
    expect(refused.json().message).toMatch(/Try again in \d+ seconds, or reset your password/);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
  });

  test('an address with no account waits just the same', async () => {
    const nobody = `nobody-${Date.now()}@robis.test`;
    await failTimes(nobody, FREE_SIGN_IN_FAILURES);
    const refused = await login(nobody, 'anything-at-all');
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error).toBe('sign_in_wait');
  });

  test('the right password before the wait starts the count again', async () => {
    const actor = await createActor('Sam');
    await failTimes(actor.email, FREE_SIGN_IN_FAILURES - 1);
    expect((await login(actor.email, ACTOR_PASSWORD)).statusCode).toBe(200);
    // Four more wrong ones are free again.
    await failTimes(actor.email, FREE_SIGN_IN_FAILURES - 1);
    expect((await login(actor.email, ACTOR_PASSWORD)).statusCode).toBe(200);
  });

  test('tries sent all at once are counted one by one', async () => {
    const actor = await createActor('Sam');
    const burst = await Promise.all(
      Array.from({ length: FREE_SIGN_IN_FAILURES + 5 }, () =>
        login(actor.email, 'not-the-password'),
      ),
    );
    const codes = burst.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 401)).toHaveLength(FREE_SIGN_IN_FAILURES);
    expect(codes.filter((c) => c === 429)).toHaveLength(5);
  });

  test('one address waiting does not hold up another', async () => {
    const first = await createActor('First');
    const second = await createActor('Second');
    await failTimes(first.email, FREE_SIGN_IN_FAILURES);
    expect((await login(second.email, ACTOR_PASSWORD)).statusCode).toBe(200);
  });
});
