import { type NodeEnv, requireNodeEnv } from './node-env.ts';
import { webOriginOf } from './origin.ts';

/**
 * The configuration every service and CLI starts from (stage 1, item 1).
 *
 * It fails closed. NODE_ENV must be stated; in development and test the
 * database and the web app fall back to their local addresses, and in
 * production nothing falls back to anything: a missing setting refuses to
 * start, naming every one that is missing, rather than quietly connect to
 * localhost or mail links nobody can open.
 *
 * Server-only, and so a subpath (`@robis/shared/config`) rather than part
 * of the package index the web app imports.
 */

type Source = Readonly<Record<string, string | undefined>>;

/** The development database `bun run db:start` runs. */
export const LOCAL_DATABASE_URL = 'postgres://robis:robis@localhost:5433/robis';
/** The web app as `bun run dev:web` serves it. */
export const LOCAL_WEB_ORIGIN = 'http://localhost:3000';

export type Config = {
  nodeEnv: NodeEnv;
  /** As the runtime role: what the services connect as. */
  databaseUrl: string;
  /** As the owner, for migrations and grants; the runtime URL if unset. */
  migrationDatabaseUrl: string;
  /** Where the internal metrics ports listen. */
  metricsHost: string;
};

/** The origin of the web app, as a browser spells it in `Origin`. */
export type WebConfig = Config & { webOrigin: string };

type Options = {
  /** The web app's origin is needed: the API, the gateway, the worker. */
  webOrigin?: boolean;
  /**
   * Connects as the owner (migrations, grants): MIGRATION_DATABASE_URL on
   * its own is enough, without the runtime role's DATABASE_URL.
   */
  asOwner?: boolean;
};

export function loadConfig(source: Source, options: Options & { webOrigin: true }): WebConfig;
export function loadConfig(source?: Source, options?: Options & { webOrigin?: false }): Config;
export function loadConfig(
  source: Source = process.env,
  options: Options = {},
): Config | WebConfig {
  // First, and on its own: every default below depends on it.
  const nodeEnv = requireNodeEnv(source.NODE_ENV);
  const production = nodeEnv === 'production';
  const problems: string[] = [];

  const setting = (name: string, local: string): string => {
    const value = source[name]?.trim();
    if (value) return value;
    if (production)
      problems.push(`${name} is required in production; nothing falls back to ${local}.`);
    return local;
  };

  const ownerUrl = source.MIGRATION_DATABASE_URL?.trim();
  // The owner CLIs: in production only the owner's own URL will do, since
  // the runtime role cannot create tables or roles; locally the two are one
  // account. Services never connect as the owner, so they need DATABASE_URL.
  const databaseUrl = options.asOwner
    ? source.DATABASE_URL?.trim() || ownerUrl || LOCAL_DATABASE_URL
    : setting('DATABASE_URL', LOCAL_DATABASE_URL);
  if (options.asOwner && production && !ownerUrl) {
    problems.push(
      'MIGRATION_DATABASE_URL is required in production; it must be the owner, not the runtime role.',
    );
  }
  const config: Config = {
    nodeEnv,
    databaseUrl,
    migrationDatabaseUrl: ownerUrl || databaseUrl,
    metricsHost: source.METRICS_HOST?.trim() || '127.0.0.1',
  };

  const webOrigin = options.webOrigin
    ? checkedWebOrigin(setting('WEB_ORIGIN', LOCAL_WEB_ORIGIN), production, problems)
    : '';

  if (problems.length > 0) {
    throw new Error(`Refusing to start:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  }
  return options.webOrigin ? { ...config, webOrigin } : config;
}

/**
 * The web origin as a browser spells it in `Origin`, or '' with the reason
 * added to `problems`. It is the origin every mailed link is built from, so
 * in production it must be https: over http, a reset link would carry its
 * token in the clear.
 */
function checkedWebOrigin(raw: string, production: boolean, problems: string[]): string {
  let origin: string;
  try {
    origin = webOriginOf(raw);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
    return '';
  }
  if (production && !origin.startsWith('https://')) {
    problems.push(
      `WEB_ORIGIN must be an https origin in production; got "${origin}". ` +
        'It is the origin password-reset links are built from.',
    );
  }
  return origin;
}

/** A port from the environment, checked now rather than failing later. */
export function portFrom(source: Source, name: string, fallback: number): number {
  const raw = source[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be a port number; got "${raw}".`);
  }
  return value;
}
