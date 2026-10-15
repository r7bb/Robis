/**
 * Create or update the application's runtime role, then exit:
 * `bun run db:roles`, after `db:migrate`, as the database owner.
 *
 * Connects with MIGRATION_DATABASE_URL (the owner), falling back to
 * DATABASE_URL for a local database where the two are the same account. The
 * role and its password come from APP_DB_ROLE and APP_DB_PASSWORD; outside
 * development a real password is required. See `roles.ts`.
 */
import { createDatabase } from './index.ts';
import { ensureRuntimeRole, runtimeRoleFromEnv } from './roles.ts';

const OWNER_URL =
  process.env.MIGRATION_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://robis:robis@localhost:5433/robis';

const role = runtimeRoleFromEnv(process.env);
const { db, close } = createDatabase(OWNER_URL, { max: 1 });

try {
  await ensureRuntimeRole(db, role);
  console.log(`Runtime role "${role.role}" is ready.`);
} catch (error) {
  // The message only: the driver's error carries the statement, and one of
  // them holds the password.
  console.error(`db:roles failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await close();
}
