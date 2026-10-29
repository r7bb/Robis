import { sql } from 'drizzle-orm';
import type { Executor } from './index.ts';

/**
 * The role the application connects as.
 *
 * Migrations run as the database owner, which can do anything, including
 * disabling the trigger that keeps the audit trail append-only. The API,
 * worker and gateway connect as this role instead, which can read and write
 * the application's tables but, on the audit tables, can only read and
 * insert: no UPDATE, no DELETE, and no TRUNCATE on any table. It does not own
 * those tables, so it cannot disable their triggers either.
 *
 * Rows still leave the audit table when their workspace is deleted. That
 * cascade runs with the table owner's rights, not the caller's, so it needs
 * no grant here.
 */

export const DEFAULT_RUNTIME_ROLE = 'robis_app';

/**
 * Tables the runtime role may read and append to, and nothing else.
 * Extended by later migrations that add append-only tables.
 */
export const APPEND_ONLY_TABLES = ['audit_events', 'account_events'] as const;

/**
 * Tables the runtime role may only read: written by owner-run triggers.
 */
export const READ_ONLY_TABLES = ['audit_tombstones'] as const;

/** A role name that needs no quoting, so it can appear in SQL text safely. */
const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

const MIN_PASSWORD_LENGTH = 16;

export type RuntimeRoleOptions = { role: string; password: string };

async function one<T>(db: Executor, query: ReturnType<typeof sql>): Promise<T> {
  const rows = (await db.execute(query)) as unknown as T[];
  return rows[0]!;
}

/**
 * A login role that can connect and see the schema, and nothing more yet:
 * created if missing, its password set, its attributes pinned. Shared by
 * every service's role; each then gets its own grants.
 */
async function ensureLoginRole(owner: Executor, options: RuntimeRoleOptions) {
  const { role, password } = options;
  if (!ROLE_NAME.test(role)) throw new Error(`Not a usable role name: "${role}"`);
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`The runtime role needs a password of ${MIN_PASSWORD_LENGTH}+ characters.`);
  }

  const name = sql.identifier(role);
  // CREATE and ALTER ROLE take no bound parameters, so Postgres quotes the
  // password as a literal itself.
  const { literal } = await one<{ literal: string }>(
    owner,
    sql`select quote_literal(${password}) as literal`,
  );
  const { database, me } = await one<{ database: string; me: string }>(
    owner,
    sql`select current_database() as database, current_user as me`,
  );
  // Never hand this role's password, or its limits, to an account that is
  // something else already: the owner, or any superuser.
  if (role === me) throw new Error(`"${role}" is the account running this; pick another name.`);
  const existing = await one<{ superuser: boolean } | undefined>(
    owner,
    sql`select rolsuper as superuser from pg_roles where rolname = ${role}`,
  );
  if (existing?.superuser) throw new Error(`"${role}" is a superuser; pick another name.`);

  // The role name passed the pattern above, so it is safe as text here.
  await owner.execute(
    sql.raw(`do $$
    begin
      if not exists (select 1 from pg_roles where rolname = '${role}') then
        create role "${role}" login;
      end if;
    end
    $$`),
  );
  // Its attributes are pinned too, so a role that existed before cannot keep
  // anything that would get round the grants below.
  await owner.execute(
    sql`alter role ${name} with login nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit password ${sql.raw(literal)}`,
  );
  await owner.execute(sql`grant connect on database ${sql.identifier(database)} to ${name}`);
  await owner.execute(sql`grant usage on schema public to ${name}`);
}

/**
 * Create the role if it does not exist, set its password, and grant it
 * exactly what the application needs. Safe to run after every migration:
 * each statement is idempotent, and it is how a newly added table gets its
 * grants.
 */
export async function ensureRuntimeRole(owner: Executor, options: RuntimeRoleOptions) {
  await ensureLoginRole(owner, options);
  const name = sql.identifier(options.role);

  // Everything the application reads and writes...
  await owner.execute(
    sql`grant select, insert, update, delete on all tables in schema public to ${name}`,
  );
  // Usage is enough to draw the next value; without update it cannot reset one.
  await owner.execute(sql`grant usage, select on all sequences in schema public to ${name}`);
  await owner.execute(sql`revoke update on all sequences in schema public from ${name}`);
  // ...and the same for tables added later, so a new migration cannot ship
  // a table the app is unable to use.
  await owner.execute(
    sql`alter default privileges in schema public grant select, insert, update, delete on tables to ${name}`,
  );
  await owner.execute(
    sql`alter default privileges in schema public grant usage, select on sequences to ${name}`,
  );

  // Never TRUNCATE anything, and on the audit tables only read and append.
  await owner.execute(sql`revoke truncate on all tables in schema public from ${name}`);
  for (const table of APPEND_ONLY_TABLES) {
    await owner.execute(sql`revoke update, delete on ${sql.identifier(table)} from ${name}`);
  }
  // The one change the audit trail allows: erasing an event's personal
  // fields (`audit-redaction.ts`). The trigger refuses anything else.
  await owner.execute(
    sql`grant update (personal, personal_salt, personal_subject_id) on audit_events to ${name}`,
  );
  for (const table of READ_ONLY_TABLES) {
    await owner.execute(
      sql`revoke insert, update, delete on ${sql.identifier(table)} from ${name}`,
    );
  }
}

/** The development default, refused in production. */
export const DEVELOPMENT_RUNTIME_PASSWORD = 'robis_app_development';

export function runtimeRoleFromEnv(env: {
  NODE_ENV?: string;
  APP_DB_ROLE?: string;
  APP_DB_PASSWORD?: string;
}): RuntimeRoleOptions {
  const role = env.APP_DB_ROLE?.trim() || DEFAULT_RUNTIME_ROLE;
  const password = env.APP_DB_PASSWORD ?? '';
  // Only a stated development or test environment is local; unset is not.
  const local = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';

  if (!local && (!password || password === DEVELOPMENT_RUNTIME_PASSWORD)) {
    throw new Error(
      'APP_DB_PASSWORD must be set, and not to the development default, outside development.',
    );
  }
  return { role, password: password || DEVELOPMENT_RUNTIME_PASSWORD };
}

/** The ML service's role (stage 1, item 8). */
export const DEFAULT_ML_ROLE = 'robis_ml';

/**
 * The ML service's role: it can read the `ml_issues` view, which the
 * migrations own, and nothing else. No table, no sequence, no write; the
 * view reads `issues` with its owner's rights, so the role needs no grant
 * on the table. Anything it was granted before is taken back first.
 */
export async function ensureMlRole(owner: Executor, options: RuntimeRoleOptions) {
  await ensureLoginRole(owner, options);
  const name = sql.identifier(options.role);
  await owner.execute(sql`revoke all on all tables in schema public from ${name}`);
  await owner.execute(sql`revoke all on all sequences in schema public from ${name}`);
  await owner.execute(sql`grant select on ml_issues to ${name}`);
}

/** The ML role from the environment, if one is asked for (`ML_DB_PASSWORD`). */
export function mlRoleFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): RuntimeRoleOptions | null {
  const password = env.ML_DB_PASSWORD ?? '';
  if (!password) return null;
  return { role: env.ML_DB_ROLE?.trim() || DEFAULT_ML_ROLE, password };
}
