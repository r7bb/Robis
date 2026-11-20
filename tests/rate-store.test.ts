import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { buildApp } from '@robis/api/app';
import { networkOf } from '@robis/api/client-network';
import { loadEnv } from '@robis/api/env';
import { resetRateLimits } from '@robis/api/rate-limit';
import {
  memoryRateStore,
  postgresRateStore,
  type RateStore,
  storedKey,
  withBackstop,
} from '@robis/api/rate-store';
import { rateLimits } from '@robis/database';
import { closeHarness, getHarness, resetDatabase, TEST_URL } from './harness.ts';

/**
 * Rate limits that hold across instances (A6). Done when: two API instances
 * sharing one database enforce one combined budget, two addresses in the
 * same IPv6 /64 share a bucket, the table keeps no address in plain text,
 * and an unreachable store lets requests through.
 */

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
});
afterAll(closeHarness);

async function instance(authPerMinute: number, rateStore: RateStore) {
  const { db } = await getHarness();
  const env = loadEnv({
    DATABASE_URL: TEST_URL,
    NODE_ENV: 'test',
    WEB_ORIGIN: 'http://localhost:3000',
  } as NodeJS.ProcessEnv);
  const app = buildApp({ db, env, rateLimits: { authPerMinute }, rateStore, signupFloorMs: 0 });
  await app.ready();
  return app;
}

let counter = 0;
/** A wrong password: one credential limiter and nothing else. */
const signIn = (app: Awaited<ReturnType<typeof instance>>, ip = '10.0.0.1') =>
  app.inject({
    method: 'POST',
    url: '/auth/login',
    remoteAddress: ip,
    payload: { email: `limited${++counter}-${Date.now()}@robis.test`, password: 'not the one' },
  });

describe('one budget across instances', () => {
  test('two instances sharing the database refuse the fourth of three, wherever it lands', async () => {
    const { db } = await getHarness();
    const first = await instance(3, postgresRateStore(db));
    const second = await instance(3, postgresRateStore(db));

    expect((await signIn(first)).statusCode).toBe(401);
    expect((await signIn(second)).statusCode).toBe(401);
    expect((await signIn(first)).statusCode).toBe(401);
    const fourth = await signIn(second);
    expect(fourth.statusCode).toBe(429);
    expect(fourth.headers['ratelimit-remaining']).toBe('0');

    await Promise.all([first.close(), second.close()]);
  });

  test('in memory, each instance counts alone, which is why production uses Postgres', async () => {
    const first = await instance(2, memoryRateStore());
    const second = await instance(2, memoryRateStore());
    for (let i = 0; i < 2; i++) {
      expect((await signIn(first)).statusCode).toBe(401);
      expect((await signIn(second)).statusCode).toBe(401);
    }
    await Promise.all([first.close(), second.close()]);
  });

  test('the table keeps keys hashed: no address in plain text', async () => {
    const { db, ownerDb } = await getHarness();
    const app = await instance(3, postgresRateStore(db));
    await signIn(app, '10.9.8.7');
    const rows = await ownerDb.select({ key: rateLimits.key }).from(rateLimits);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.key.includes('10.9.8.7'))).toBe(false);
    await app.close();
  });

  test('an unreachable store lets requests through rather than lock everyone out', async () => {
    const down = () => Promise.reject(new Error('down'));
    const app = await instance(1, { hit: down, peek: down, clearPrefix: down, takeBack: down });
    expect((await signIn(app)).statusCode).toBe(401);
    expect((await signIn(app)).statusCode).toBe(401);
    await app.close();
  });
});

describe('when the shared store fails', () => {
  test('the memory behind it counts instead, so the limit loosens to per instance but holds', async () => {
    const down = () => Promise.reject(new Error('pool full'));
    const warned: string[] = [];
    const store = withBackstop(
      { hit: down, peek: down, clearPrefix: down, takeBack: down },
      memoryRateStore(),
      (message) => warned.push(message),
    );
    const app = await instance(1, store);
    expect((await signIn(app)).statusCode).toBe(401);
    expect((await signIn(app)).statusCode).toBe(429);
    // Warned once, not once a request.
    expect(warned).toHaveLength(1);
    await app.close();
  });

  test('a count inside a transaction is on its connection, and lands with it', async () => {
    const { db } = await getHarness();
    const store = postgresRateStore(db);
    await db.transaction(async (tx) => {
      expect((await store.hit('t:within', 60_000, { within: tx })).count).toBe(1);
      expect((await store.hit('t:within', 60_000, { within: tx })).count).toBe(2);
    });
    expect((await store.peek('t:within'))?.count).toBe(2);
  });
});

describe('IPv6 callers by their /64', () => {
  test('an IPv4 address inside IPv6, however spelt, counts as that address', () => {
    expect(networkOf('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(networkOf('0:0:0:0:0:ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(networkOf('::ffff:0102:0304')).toBe('1.2.3.4');
    expect(networkOf('64:ff9b::1.2.3.4')).toBe('1.2.3.4');
    expect(networkOf('[2001:db8:1:2::1%eth0]')).toBe('2001:db8:1:2::/64');
    expect(networkOf('not an address|x')).toBe('not-an-address:not an address%7Cx');
  });

  test('two addresses in one /64 share a bucket; the next /64 has its own', async () => {
    const app = await instance(2, memoryRateStore());
    expect((await signIn(app, '2001:db8:1:2::1')).statusCode).toBe(401);
    expect((await signIn(app, '2001:db8:1:2:ffff:0:0:9')).statusCode).toBe(401);
    expect((await signIn(app, '2001:0db8:0001:0002::42')).statusCode).toBe(429);
    expect((await signIn(app, '2001:db8:1:3::1')).statusCode).toBe(401);
    await app.close();
  });
});

describe('the stores on their own', () => {
  test('fixed windows start afresh; sliding ones run on while hits keep coming', async () => {
    let now = 1_000_000;
    const store = memoryRateStore({ now: () => now });
    expect((await store.hit('t:a', 1000)).count).toBe(1);
    now += 900;
    expect((await store.hit('t:a', 1000)).count).toBe(2);
    now += 200;
    expect((await store.hit('t:a', 1000)).count).toBe(1);

    expect((await store.hit('s:a', 1000, { sliding: true })).count).toBe(1);
    now += 900;
    expect((await store.hit('s:a', 1000, { sliding: true })).count).toBe(2);
    now += 900;
    expect((await store.hit('s:a', 1000, { sliding: true })).count).toBe(3);
    now += 1100;
    expect(await store.peek('s:a')).toBeNull();
  });

  test('in Postgres, the same counts by the database clock, and a prefix of whole parts clears', async () => {
    const { db } = await getHarness();
    const store = postgresRateStore(db);
    const key = 'p:sam@example.test|10.0.0.1';
    expect((await store.hit(key, 60_000)).count).toBe(1);
    expect((await store.hit(key, 60_000)).count).toBe(2);
    expect((await store.hit('p:sam@example.test|10.0.0.2', 60_000, { sliding: true })).count).toBe(
      1,
    );
    expect((await store.hit('p:samuel@example.test|10.0.0.1', 60_000)).count).toBe(1);
    expect((await store.peek(key))?.count).toBe(2);

    await store.clearPrefix('p:sam@example.test|');
    expect(await store.peek(key)).toBeNull();
    expect(await store.peek('p:sam@example.test|10.0.0.2')).toBeNull();
    expect((await store.peek('p:samuel@example.test|10.0.0.1'))?.count).toBe(1);
    expect(storedKey(key)).not.toContain('sam');
  });

  test('a window that has ended starts afresh in Postgres too', async () => {
    const { db } = await getHarness();
    const store = postgresRateStore(db);
    expect((await store.hit('t:short', 1)).count).toBe(1);
    await Bun.sleep(20);
    expect((await store.hit('t:short', 1)).count).toBe(1);
  });
});
