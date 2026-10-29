/**
 * Create or update the application's runtime role, then exit:
 * `bun run db:roles`, after `db:migrate`, as the database owner.
 *
 * Connects with MIGRATION_DATABASE_URL (the owner), falling back to
 * DATABASE_URL for a local database where the two are the same account. The
 * role and its password come from APP_DB_ROLE and APP_DB_PASSWORD; outside
 * development a real password is required. See `roles.ts`.
 */
import { loadConfig } from '@robis/shared/config';
import { createDatabase } from './index.ts';
import { ensureMlRole, ensureRuntimeRole, mlRoleFromEnv, runtimeRoleFromEnv } from './roles.ts';

// Before anything else, and failing closed: see `loadConfig`.
const { migrationDatabaseUrl: OWNER_URL } = loadConfig(process.env, { asOwner: true });

const role = runtimeRoleFromEnv(process.env);
const { db, close } = createDatabase(OWNER_URL, { max: 1 });

try {
  await ensureRuntimeRole(db, role);
  console.log(`Runtime role "${role.role}" is ready.`);
  // The ML service's own role, when one is asked for: it reads one view.
  const ml = mlRoleFromEnv(process.env);
  if (ml) {
    await ensureMlRole(db, ml);
    console.log(`ML role "${ml.role}" is ready: it reads ml_issues and nothing else.`);
  }
} catch (error) {
  // The message only: the driver's error carries the statement, and one of
  // them holds the password.
  console.error(`db:roles failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await close();
}
