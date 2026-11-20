import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { memoryRateStore, postgresRateStore } from '@robis/api/rate-store';
import {
  ADDRESS_FAILURES_PER_HOUR,
  admitSignInAttempt,
  clearSignInFailures,
  FIRST_SIGN_IN_WAIT_MS,
  FREE_SIGN_IN_FAILURES,
  MAX_SIGN_IN_WAIT_MS,
  networkOf,
  waitAfter,
} from '@robis/api/sign-in-waits';
import {
  ACTOR_PASSWORD,
  closeHarness,
  createActor,
  getHarness,
  request,
  resetDatabase,
} from './harness.ts';

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
  const HOUR = 60 * 60_000;
  let now = 0;
  let store = memoryRateStore({ now: () => now });
  beforeEach(() => {
    now = 1_000_000;
    store = memoryRateStore({ now: () => now });
  });
  const admit = (address: string, place = HERE) => admitSignInAttempt(store, address, place);
  /** Tries let through, one after another. */
  async function fail(address: string, times: number, place = HERE) {
    for (let i = 0; i < times; i++) expect(await admit(address, place)).toBe(0);
  }
  /** Tries let through, waiting out each wait before the next. */
  async function failPatiently(address: string, times: number, place = HERE) {
    for (let i = 0; i < times; i++) {
      const wait = await admit(address, place);
      if (wait > 0) {
        now += wait;
        expect(await admit(address, place)).toBe(0);
      }
    }
  }

  test('none while free, then doubling from the first, never past the ceiling', () => {
    expect(waitAfter(FREE_SIGN_IN_FAILURES - 1)).toBe(0);
    expect(waitAfter(FREE_SIGN_IN_FAILURES)).toBe(FIRST_SIGN_IN_WAIT_MS);
    expect(waitAfter(FREE_SIGN_IN_FAILURES + 1)).toBe(FIRST_SIGN_IN_WAIT_MS * 2);
    expect(waitAfter(FREE_SIGN_IN_FAILURES + 2)).toBe(FIRST_SIGN_IN_WAIT_MS * 4);
    expect(waitAfter(FREE_SIGN_IN_FAILURES + 40)).toBe(MAX_SIGN_IN_WAIT_MS);
  });

  test('run from the last failure, are the same however the address is typed, and a try in the wait counts for nothing', async () => {
    await fail('Sam@Example.test', FREE_SIGN_IN_FAILURES);
    expect(await admit('sam@example.test ')).toBe(FIRST_SIGN_IN_WAIT_MS);
    now += FIRST_SIGN_IN_WAIT_MS / 2;
    // Refused early, and not counted: the wait is the same one, not doubled.
    expect(await admit('sam@example.test')).toBe(FIRST_SIGN_IN_WAIT_MS / 2);
    now += FIRST_SIGN_IN_WAIT_MS / 2;
    expect(await admit('sam@example.test')).toBe(0);
    expect(await admit('sam@example.test')).toBe(FIRST_SIGN_IN_WAIT_MS * 2);
    await clearSignInFailures(store, 'SAM@example.test');
    expect(await admit('sam@example.test')).toBe(0);
  });

  test('wrong passwords from one place do not hold up the owner elsewhere', async () => {
    await failPatiently('owner@example.test', FREE_SIGN_IN_FAILURES + 10, '198.51.100.9');
    expect(await admit('owner@example.test', '198.51.100.9')).toBe(MAX_SIGN_IN_WAIT_MS);
    expect(await admit('owner@example.test', HERE)).toBe(0);
  });

  test('past the cap from everywhere in an hour, every place waits for the hour', async () => {
    for (let i = 0; i < ADDRESS_FAILURES_PER_HOUR; i++) {
      expect(await admit('spread@example.test', `10.0.${i >> 8}.${i & 255}`)).toBe(0);
    }
    expect(await admit('spread@example.test', HERE)).toBe(HOUR);
    now += HOUR + 1;
    expect(await admit('spread@example.test', HERE)).toBe(0);
  });

  test('the cap from everywhere starts afresh each hour, so it never goes stale', async () => {
    const spread = async (from: number) => {
      for (let i = 0; i < ADDRESS_FAILURES_PER_HOUR; i++) {
        const n = from + i;
        expect(await admit('again@example.test', `10.1.${n >> 8}.${n & 255}`)).toBe(0);
      }
    };
    await spread(0);
    now += HOUR + 1;
    await spread(1000);
    expect(await admit('again@example.test', HERE)).toBe(HOUR);
  });

  test('IPv6 addresses in one /64 are one place', async () => {
    expect(networkOf('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(networkOf('2001:0db8:0001:0002:ffff:1:2:3')).toBe('2001:db8:1:2::/64');
    expect(networkOf('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(networkOf('192.0.2.1')).toBe('192.0.2.1');
    for (let i = 0; i < FREE_SIGN_IN_FAILURES; i++) {
      expect(await admit('six@example.test', `2001:db8:1:2::${i + 1}`)).toBe(0);
    }
    expect(await admit('six@example.test', '2001:db8:1:2::99')).toBe(FIRST_SIGN_IN_WAIT_MS);
    expect(await admit('six@example.test', '2001:db8:1:3::1')).toBe(0);
  });

  test('forget failures after an hour, the count starting again', async () => {
    await fail('old@example.test', FREE_SIGN_IN_FAILURES);
    now += 61 * 60_000;
    await fail('old@example.test', FREE_SIGN_IN_FAILURES);
    expect(await admit('old@example.test')).toBe(FIRST_SIGN_IN_WAIT_MS);
  });
});

/** Shared by every API instance (A6): the same rules, in Postgres. */
describe('the waits, shared in Postgres', () => {
  const HERE = '198.51.100.20';

  test('a burst across instances is counted one by one; a try in the wait counts for nothing', async () => {
    const { db } = await getHarness();
    const instances = [postgresRateStore(db), postgresRateStore(db)];
    const burst = await Promise.all(
      Array.from({ length: FREE_SIGN_IN_FAILURES + 5 }, (_, i) =>
        admitSignInAttempt(instances[i % 2]!, 'burst@example.test', HERE),
      ),
    );
    expect(burst.filter((wait) => wait === 0)).toHaveLength(FREE_SIGN_IN_FAILURES);
    // A burst is not forgiven: tries refused while others were counting
    // could not be taken back, so the wait is at least the first one.
    const wait = await admitSignInAttempt(instances[0]!, 'burst@example.test', HERE);
    expect(wait).toBeGreaterThan(FIRST_SIGN_IN_WAIT_MS - 5_000);
    // One more try on its own, during the wait, counts for nothing.
    const again = await admitSignInAttempt(instances[1]!, 'burst@example.test', HERE);
    expect(again).toBeLessThanOrEqual(wait);
    expect(again).toBeGreaterThan(wait - 5_000);

    await clearSignInFailures(instances[1]!, 'Burst@Example.test');
    expect(await admitSignInAttempt(instances[0]!, 'burst@example.test', HERE)).toBe(0);
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
