import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { LOCAL_DATABASE_URL, LOCAL_WEB_ORIGIN, loadConfig, portFrom } from '@robis/shared/config';

/**
 * The one configuration loader every service and CLI starts from (stage 1,
 * item 1). It fails closed: in production nothing falls back to a local
 * default, and an unset NODE_ENV refuses to load at all.
 */

const ROOT = join(import.meta.dir, '..');

describe('the configuration loader', () => {
  test('refuses an unset NODE_ENV', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x' })).toThrow(/NODE_ENV/);
  });

  test('in development, falls back to the local database and web app', () => {
    const config = loadConfig({ NODE_ENV: 'development' }, { webOrigin: true });
    expect(config.databaseUrl).toBe(LOCAL_DATABASE_URL);
    expect(config.migrationDatabaseUrl).toBe(LOCAL_DATABASE_URL);
    expect(config.webOrigin).toBe(LOCAL_WEB_ORIGIN);
    expect(config.metricsHost).toBe('127.0.0.1');
  });

  test('in production, refuses a missing database rather than guess localhost', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
  });

  test('in production, refuses a missing or plain-http web origin', () => {
    const base = { NODE_ENV: 'production', DATABASE_URL: 'postgres://db/robis' };
    expect(() => loadConfig(base, { webOrigin: true })).toThrow(/WEB_ORIGIN/);
    expect(() =>
      loadConfig({ ...base, WEB_ORIGIN: 'http://robis.example' }, { webOrigin: true }),
    ).toThrow(/https/);
    const config = loadConfig(
      { ...base, WEB_ORIGIN: 'HTTPS://Robis.Example/' },
      { webOrigin: true },
    );
    expect(config.webOrigin).toBe('https://robis.example');
  });

  test('a CLI that does not ask for the web origin does not need one in production', () => {
    const config = loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://db/robis' });
    expect(config.databaseUrl).toBe('postgres://db/robis');
  });

  test('migrations use their own owner URL when given one', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://app@db/robis',
      MIGRATION_DATABASE_URL: 'postgres://owner@db/robis',
    });
    expect(config.migrationDatabaseUrl).toBe('postgres://owner@db/robis');
  });

  test('the owner CLIs need only the owner URL, but in production they need that one', () => {
    const owner = loadConfig(
      { NODE_ENV: 'production', MIGRATION_DATABASE_URL: 'postgres://owner@db/robis' },
      { asOwner: true },
    );
    expect(owner.migrationDatabaseUrl).toBe('postgres://owner@db/robis');
    // Not the runtime role's URL instead: it cannot create tables or roles,
    // and would fail late with a permission error.
    expect(() =>
      loadConfig(
        { NODE_ENV: 'production', DATABASE_URL: 'postgres://app@db/robis' },
        { asOwner: true },
      ),
    ).toThrow(/MIGRATION_DATABASE_URL is required/);
    // Locally the two are one account, so the runtime URL will do.
    const local = loadConfig({ NODE_ENV: 'development' }, { asOwner: true });
    expect(local.migrationDatabaseUrl).toBe(LOCAL_DATABASE_URL);
  });

  test('a service given only the owner URL refuses, rather than run as the owner', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', MIGRATION_DATABASE_URL: 'postgres://owner@db/robis' }),
    ).toThrow(/DATABASE_URL is required/);
  });

  test('a rejected web origin is never echoed, since it may hold a password', () => {
    let message = '';
    try {
      loadConfig(
        { NODE_ENV: 'development', WEB_ORIGIN: 'https://ada:hunter2@robis.example' },
        { webOrigin: true },
      );
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain('WEB_ORIGIN');
    expect(message).not.toContain('hunter2');
  });

  test('says everything that is wrong at once', () => {
    let message = '';
    try {
      loadConfig({ NODE_ENV: 'production' }, { webOrigin: true });
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('WEB_ORIGIN');
  });

  test('checks a port now rather than failing later', () => {
    expect(portFrom({}, 'API_PORT', 4000)).toBe(4000);
    expect(portFrom({ API_PORT: '4100' }, 'API_PORT', 4000)).toBe(4100);
    expect(() => portFrom({ API_PORT: 'eighty' }, 'API_PORT', 4000)).toThrow(/API_PORT/);
    expect(() => portFrom({ API_PORT: '70000' }, 'API_PORT', 4000)).toThrow(/API_PORT/);
  });
});

/** Start an entry point in production with only the settings given. */
async function bootInProduction(entry: string, settings: Record<string, string> = {}) {
  // No .env either: a developer's own would otherwise supply the answer.
  const child = Bun.spawn(['bun', '--no-env-file', entry, '00000000-0000-4000-8000-000000000000'], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      NODE_ENV: 'production',
      ...settings,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const timer = setTimeout(() => child.kill(), 15_000);
  const code = await child.exited;
  clearTimeout(timer);
  return { code, stderr: await new Response(child.stderr).text() };
}

describe('every entry point loads through it', () => {
  for (const entry of [
    'backend/api/src/main.ts',
    'backend/realtime/src/main.ts',
    'backend/worker/src/main.ts',
    'backend/database/src/migrate-cli.ts',
    'backend/database/src/roles-cli.ts',
    'backend/database/src/audit-erase-cli.ts',
    'backend/database/src/audit-seal-cli.ts',
    'scripts/db/grant-owner.ts',
  ]) {
    test(`${entry}, in production with no database, refuses rather than use localhost`, async () => {
      const { code, stderr } = await bootInProduction(entry);
      expect(code).not.toBe(0);
      // The loader's own refusal, not some later connection error.
      expect(stderr).toContain('Refusing to start');
      expect(stderr).toContain('DATABASE_URL is required in production');
    });
  }

  for (const entry of [
    'backend/api/src/main.ts',
    'backend/realtime/src/main.ts',
    'backend/worker/src/main.ts',
  ]) {
    test(`${entry}, in production with no WEB_ORIGIN, refuses rather than use localhost`, async () => {
      const { code, stderr } = await bootInProduction(entry, {
        DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none',
      });
      expect(code).not.toBe(0);
      expect(stderr).toContain('Refusing to start');
      expect(stderr).toContain('WEB_ORIGIN is required in production');
    });
  }
});
