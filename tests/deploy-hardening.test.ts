import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { buildApp } from '@robis/api/app';
import { loadEnv } from '@robis/api/env';
import { serveMetrics } from '@robis/api/metrics';
import { sessions } from '@robis/database';
import { TERMS_VERSION } from '@robis/shared';
import { localDiskStorage } from '@robis/storage';
import { eq } from 'drizzle-orm';
import {
  closeHarness,
  createActor,
  createWorkspace,
  getHarness,
  MEDIA_ROOT,
  request,
  resetDatabase,
  signUp as signUpThrough,
  TEST_URL,
} from './harness.ts';

/**
 * Review fixes before deployment: the services refuse to guess their
 * environment, production cookies are Secure and host-only, writes from
 * another site are refused, metrics are off the public port, idle sessions
 * end, and deleting a workspace needs the password.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const ROOT = join(import.meta.dir, '..');
const PASSWORD = 'correct-horse-battery-staple';

/** Run a service entry point with no NODE_ENV, and see it refuse. */
async function bootWithoutNodeEnv(entry: string) {
  // No .env either: a developer's own would otherwise supply NODE_ENV.
  const child = Bun.spawn(['bun', '--no-env-file', entry], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const timer = setTimeout(() => child.kill(), 15_000);
  const code = await child.exited;
  clearTimeout(timer);
  return { code, stderr: await new Response(child.stderr).text() };
}

describe('NODE_ENV', () => {
  test('unset, the API configuration refuses to load', () => {
    expect(() => loadEnv({ DATABASE_URL: TEST_URL } as unknown as NodeJS.ProcessEnv)).toThrow(
      /NODE_ENV/,
    );
  });

  test('in production, the API refuses a missing database or web origin, or a plain-http one', () => {
    const production = (settings: Record<string, string>) => () =>
      loadEnv({ NODE_ENV: 'production', MEDIA_DIR: MEDIA_ROOT, ...settings } as NodeJS.ProcessEnv);
    expect(production({ WEB_ORIGIN: 'https://robis.example' })).toThrow(/DATABASE_URL/);
    expect(production({ DATABASE_URL: TEST_URL })).toThrow(/WEB_ORIGIN/);
    expect(production({ DATABASE_URL: TEST_URL, WEB_ORIGIN: 'http://robis.example' })).toThrow(
      /https/,
    );
  });

  test('set to something else, it refuses too', () => {
    expect(() =>
      loadEnv({ DATABASE_URL: TEST_URL, NODE_ENV: 'staging' } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/NODE_ENV/);
  });

  for (const entry of [
    'backend/api/src/main.ts',
    'backend/realtime/src/main.ts',
    'backend/worker/src/main.ts',
    'backend/database/src/migrate-cli.ts',
    'backend/database/src/roles-cli.ts',
    'backend/database/src/audit-erase-cli.ts',
    'backend/database/src/audit-seal-cli.ts',
    'scripts/db/migrate.ts',
    'scripts/db/seed.ts',
    'scripts/db/grant-owner.ts',
  ]) {
    test(`unset, ${entry} refuses to start`, async () => {
      const { code, stderr } = await bootWithoutNodeEnv(entry);
      expect(code).not.toBe(0);
      expect(stderr).toContain('NODE_ENV');
    });
  }
});

/** The API as production would run it, against the test database. */
async function productionApp() {
  const { db } = await getHarness();
  const env = loadEnv({
    DATABASE_URL: TEST_URL,
    NODE_ENV: 'production',
    WEB_ORIGIN: 'https://robis.example',
    // Relaxed on purpose: production must not listen to it.
    COOKIE_SECURE: '0',
    MEDIA_DIR: MEDIA_ROOT,
  } as NodeJS.ProcessEnv);
  // The same generous budgets as the harness: the limiter keys on the
  // address, which every suite shares.
  const app = buildApp({
    db,
    env,
    storage: localDiskStorage(MEDIA_ROOT),
    rateLimits: { authPerMinute: 100_000 },
    signupFloorMs: 0,
  });
  await app.ready();
  return app;
}

async function signUp(app: Awaited<ReturnType<typeof productionApp>>) {
  const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  // Email first, as everyone signs up: the shared worker mails the link.
  return signUpThrough(
    {
      email: `prod-${stamp}@robis.test`,
      name: 'Prod',
      username: `prod_${stamp}`,
      password: PASSWORD,
      ageConfirmed: true,
      termsVersion: TERMS_VERSION,
    },
    app,
  );
}

describe('session cookies in production', () => {
  test('are Secure and host-only, whatever COOKIE_SECURE says', async () => {
    const app = await productionApp();
    try {
      const response = await signUp(app);
      expect(response.statusCode).toBe(201);
      const cookie = String(response.headers['set-cookie']);
      expect(cookie.startsWith('__Host-robis_session=')).toBe(true);
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('Path=/');
      expect(cookie).not.toContain('Domain=');

      // And that is the cookie a request is recognised by.
      const me = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { cookie: cookie.split(';')[0]! },
      });
      expect(me.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});

describe('API responses', () => {
  test('may not run script or be framed when opened directly, and are not sniffed', async () => {
    const response = await request('/health');
    expect(response.headers['content-security-policy']).toBe(
      "default-src 'none'; frame-ancestors 'none'; sandbox",
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    // Plain HTTP in tests: nothing pins it.
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });

  test('pin HTTPS in production, for this host only', async () => {
    const app = await productionApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.headers['strict-transport-security']).toMatch(/^max-age=\d{8,}$/);
    } finally {
      await app.close();
    }
  });
});

describe('writes from another site', () => {
  test('are refused by Origin, and by Sec-Fetch-Site', async () => {
    const owner = await createActor('Owner');
    const create = (headers: Record<string, string>) =>
      request('/workspaces', { method: 'POST', actor: owner, payload: { name: 'X' }, headers });

    const foreign = await create({ origin: 'https://evil.example' });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json().error).toBe('forbidden_origin');

    const crossSite = await create({ 'sec-fetch-site': 'cross-site' });
    expect(crossSite.statusCode).toBe(403);

    // The web app's own origin, and a tool with no browser headers, write.
    expect((await create({ origin: 'http://localhost:3000' })).statusCode).toBe(201);
    expect((await create({ 'sec-fetch-site': 'same-site' })).statusCode).toBe(201);
    expect((await create({})).statusCode).toBe(201);
  });

  test('the web app is recognised whatever the spelling of WEB_ORIGIN', () => {
    const env = loadEnv({
      DATABASE_URL: TEST_URL,
      NODE_ENV: 'test',
      WEB_ORIGIN: 'HTTP://LOCALHOST:3000/',
    } as unknown as NodeJS.ProcessEnv);
    expect(env.WEB_ORIGIN).toBe('http://localhost:3000');
    expect(() =>
      loadEnv({
        DATABASE_URL: TEST_URL,
        NODE_ENV: 'test',
        WEB_ORIGIN: 'not a url',
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/WEB_ORIGIN/);
    expect(() =>
      loadEnv({
        DATABASE_URL: TEST_URL,
        NODE_ENV: 'test',
        WEB_ORIGIN: 'https://robis.example/app',
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/WEB_ORIGIN/);
  });

  test('a read from another site is not a write, and is not refused here', async () => {
    const owner = await createActor('Owner');
    const read = await request('/workspaces', {
      actor: owner,
      headers: { origin: 'https://evil.example' },
    });
    expect(read.statusCode).toBe(200);
  });
});

describe('metrics', () => {
  test('are not on the public port; health still is', async () => {
    expect((await request('/metrics')).statusCode).toBe(404);
    expect((await request('/health')).statusCode).toBe(200);
  });

  test('are on their own internal port', async () => {
    const { app } = await getHarness();
    const server = serveMetrics(app, { port: 0, hostname: '127.0.0.1' });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/metrics`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('http_requests_total');
      expect((await fetch(`http://127.0.0.1:${server.port}/anything`)).status).toBe(404);
    } finally {
      server.stop(true);
    }
  });
});

describe('sessions', () => {
  async function lastUsed(actorId: string, daysAgo: number) {
    const { db } = await getHarness();
    await db
      .update(sessions)
      .set({ lastUsedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000) })
      .where(eq(sessions.userId, actorId));
  }

  test('end after 7 idle days, though they have 30 to live', async () => {
    const actor = await createActor();
    await lastUsed(actor.id, 8);
    expect((await request('/auth/me', { actor })).statusCode).toBe(401);
  });

  test('used within the week, stay', async () => {
    const actor = await createActor();
    await lastUsed(actor.id, 6);
    expect((await request('/auth/me', { actor })).statusCode).toBe(200);
  });
});

describe('deleting a workspace', () => {
  test('asks for the password, and refuses a wrong one', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const remove = (payload?: unknown) =>
      request(`/workspaces/${workspace.id}`, { method: 'DELETE', actor: owner, payload });

    expect((await remove()).statusCode).toBe(400);
    const wrong = await remove({ password: 'not the password' });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error).toBe('password_incorrect');
    expect((await request(`/workspaces/${workspace.id}`, { actor: owner })).statusCode).toBe(200);

    expect((await remove({ password: PASSWORD })).statusCode).toBe(204);
  });

  test('guesses are limited per person, not per address', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    let last = 0;
    for (let n = 0; n < 11; n++) {
      last = (
        await request(`/workspaces/${workspace.id}`, {
          method: 'DELETE',
          actor: owner,
          payload: { password: 'not the password' },
        })
      ).statusCode;
    }
    expect(last).toBe(429);

    // Someone else at the same address still has their own budget.
    const other = await createActor('Other');
    const theirs = await createWorkspace(other);
    const response = await request(`/workspaces/${theirs.id}`, {
      method: 'DELETE',
      actor: other,
      payload: { password: PASSWORD },
    });
    expect(response.statusCode).toBe(204);
  });
});
