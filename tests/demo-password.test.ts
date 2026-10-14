import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { buildApp } from '@robis/api/app';
import { loadEnv } from '@robis/api/env';
import { hashPassword } from '@robis/auth';
import { users } from '@robis/database';
import { DEMO_PASSWORD } from '@robis/shared';
import { eq } from 'drizzle-orm';
import {
  closeHarness,
  createActor,
  getHarness,
  getMailer,
  request,
  resetDatabase,
  TEST_URL,
} from './harness.ts';

/**
 * The demo password is printed in the README. The shared test app runs
 * with NODE_ENV=test, which is "not development", so it behaves the way a
 * real deployment must: the password is refused everywhere.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const OTHER = 'a-perfectly-ordinary-password';

/** An account whose stored password is the demo one, as a copied seed would have. */
async function seededDemoAccount() {
  const { db } = await getHarness();
  const actor = await createActor('Seeded');
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(DEMO_PASSWORD) })
    .where(eq(users.id, actor.id));
  return actor;
}

describe('outside development', () => {
  test('signing in with the demo password fails exactly like a wrong password', async () => {
    const actor = await seededDemoAccount();

    const demo = await request('/auth/login', {
      method: 'POST',
      payload: { email: actor.email, password: DEMO_PASSWORD },
    });
    const wrong = await request('/auth/login', {
      method: 'POST',
      payload: { email: actor.email, password: 'not-the-password-at-all' },
    });

    expect(demo.statusCode).toBe(401);
    expect(demo.body).toBe(wrong.body);
  });

  test('it cannot be chosen at sign-up', async () => {
    const response = await request('/auth/register', {
      method: 'POST',
      payload: {
        email: 'new@robis.test',
        name: 'New',
        username: 'new_person',
        password: DEMO_PASSWORD,
        ageConfirmed: true,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('demo_password');
  });

  test('it cannot be set by changing a password', async () => {
    const actor = await createActor('Changer');
    const response = await request('/auth/password', {
      method: 'POST',
      actor,
      payload: { currentPassword: 'correct-horse-battery-staple', newPassword: DEMO_PASSWORD },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('demo_password');
  });

  test('it cannot be set through a reset link', async () => {
    const actor = await createActor('Resetter');
    await request('/auth/password/forgot', { method: 'POST', payload: { email: actor.email } });
    const mail = (await getMailer()).lastTo(actor.email);
    const token = /token=([A-Za-z0-9_-]+)/.exec(mail?.text ?? '')?.[1];

    const response = await request('/auth/password/reset', {
      method: 'POST',
      payload: { token, newPassword: DEMO_PASSWORD },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('demo_password');

    // The link was not spent on the refusal: a real password still works.
    const retry = await request('/auth/password/reset', {
      method: 'POST',
      payload: { token, newPassword: OTHER },
    });
    expect(retry.statusCode).toBe(200);
  });
});

describe('in development', () => {
  test('the seeded demo account still signs in, so the local demo works', async () => {
    const actor = await seededDemoAccount();
    const { db } = await getHarness();

    const devApp = buildApp({
      db,
      env: loadEnv({
        DATABASE_URL: TEST_URL,
        NODE_ENV: 'development',
        WEB_ORIGIN: 'http://localhost:3000',
      } as NodeJS.ProcessEnv),
      // Rate-limit buckets are shared by the whole test process; earlier
      // suites have spent the default budget, as the shared harness avoids.
      rateLimits: { authPerMinute: 100_000 },
    });
    await devApp.ready();

    try {
      const response = await devApp.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: actor.email, password: DEMO_PASSWORD },
      });
      expect(response.statusCode).toBe(200);
    } finally {
      await devApp.close();
    }
  });
});
