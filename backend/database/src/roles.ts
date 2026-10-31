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
  // Erasing an event's personal fields is not the app's to do: only
  // `audit:erase`'s own role may (`ensureEraserRole`). Taken back from
  // databases where an earlier version granted it.
  await owner.execute(
    sql`revoke update (personal, personal_salt, personal_subject_id) on audit_events from ${name}`,
  );
  // Nor may it see or touch the record of erasures. It may file a request
  // for one (deleting an account does), and nothing more.
  await owner.execute(sql`revoke all on erasures from ${name}`);
  await owner.execute(sql`revoke all on erasure_requests from ${name}`);
  await owner.execute(sql`grant insert on erasure_requests to ${name}`);
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

/** What a service role may do to one table. */
type TableGrants = Readonly<Record<string, readonly ('select' | 'insert' | 'update' | 'delete')[]>>;

/**
 * The realtime gateway's grants (stage 1, item 8): it resolves a session
 * cookie, checks membership, and serves documents. Nothing else.
 */
export const GATEWAY_GRANTS: TableGrants = {
  sessions: ['select', 'update'],
  users: ['select'],
  workspaces: ['select'],
  workspace_members: ['select'],
  documents: ['select', 'update'],
  // Delete: compaction folds old updates into the document's snapshot.
  document_updates: ['select', 'insert', 'delete'],
};

/**
 * The worker's grants: its jobs, the mail and notifications it sends, the
 * housekeeping it does, and what those read.
 */
export const WORKER_GRANTS: TableGrants = {
  jobs: ['select', 'insert', 'update', 'delete'],
  users: ['select'],
  workspaces: ['select'],
  workspace_members: ['select'],
  workspace_invitations: ['select'],
  projects: ['select'],
  issues: ['select'],
  comments: ['select'],
  comment_mentions: ['select'],
  // Read by the nudge scan: who has started a document yet.
  documents: ['select'],
  // Delete: read notifications past their retention (stage 3, item 30).
  notifications: ['select', 'insert', 'delete'],
  sessions: ['select', 'delete'],
  // Idempotency keys past their replay window (stage 3, item 30).
  mutations: ['select', 'delete'],
  auth_tokens: ['select', 'insert', 'update', 'delete'],
  username_history: ['select', 'delete'],
  signups: ['select', 'update', 'delete'],
  // The audit stream: it reads the trail, never changes it, and keeps its
  // own place per workspace.
  audit_events: ['select'],
  audit_stream_cursors: ['select', 'insert', 'update'],
};

export const DEFAULT_GATEWAY_ROLE = 'robis_gateway';
export const DEFAULT_WORKER_ROLE = 'robis_worker';

/**
 * A service role with exactly `grants` and nothing else: every table and
 * sequence privilege is revoked first, then each listed table gets its
 * listed rights. Sequences can be drawn from (inserts need that), never
 * reset.
 */
async function ensureServiceRole(
  owner: Executor,
  options: RuntimeRoleOptions,
  grants: TableGrants,
) {
  await ensureLoginRole(owner, options);
  const name = sql.identifier(options.role);
  await owner.execute(sql`revoke all on all tables in schema public from ${name}`);
  await owner.execute(sql`revoke all on all sequences in schema public from ${name}`);
  for (const [table, rights] of Object.entries(grants)) {
    // Rights come from the constant above, never from input.
    await owner.execute(
      sql`grant ${sql.raw(rights.join(', '))} on ${sql.identifier(table)} to ${name}`,
    );
  }
  await owner.execute(sql`grant usage on all sequences in schema public to ${name}`);
}

export function ensureGatewayRole(owner: Executor, options: RuntimeRoleOptions) {
  return ensureServiceRole(owner, options, GATEWAY_GRANTS);
}

export function ensureWorkerRole(owner: Executor, options: RuntimeRoleOptions) {
  return ensureServiceRole(owner, options, WORKER_GRANTS);
}

/** A service role from the environment, if its password is given. */
export function serviceRoleFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  prefix: 'GATEWAY' | 'WORKER' | 'ERASER',
  fallback: string,
): RuntimeRoleOptions | null {
  const password = env[`${prefix}_DB_PASSWORD`] ?? '';
  if (!password) return null;
  return { role: env[`${prefix}_DB_ROLE`]?.trim() || fallback, password };
}

/** `audit:erase`'s own role (stage 1, item 9). */
export const DEFAULT_ERASER_ROLE = 'robis_eraser';

/**
 * The only role that may erase: blank the audit trail's personal fields,
 * forget former usernames, and record that it did. Nothing else; the
 * trigger on `audit_events` still refuses any other change.
 */
export async function ensureEraserRole(owner: Executor, options: RuntimeRoleOptions) {
  await ensureLoginRole(owner, options);
  const name = sql.identifier(options.role);
  await owner.execute(sql`revoke all on all tables in schema public from ${name}`);
  await owner.execute(sql`revoke all on all sequences in schema public from ${name}`);
  await owner.execute(sql`grant select (id, personal_subject_id) on audit_events to ${name}`);
  await owner.execute(
    sql`grant update (personal, personal_salt, personal_subject_id) on audit_events to ${name}`,
  );
  await owner.execute(sql`grant select, update on username_history to ${name}`);
  await owner.execute(sql`grant insert on erasures to ${name}`);
  // The requests deleted accounts filed: read them, mark them done.
  await owner.execute(sql`grant select, update (processed_at) on erasure_requests to ${name}`);
}
