/**
 * Apply every migration file, then exit.
 *
 * Lives in this package so it runs wherever the package is installed: in a
 * container only workspace packages can resolve `@robis/database`, so the
 * image runs this file directly. `bun run db:migrate` reaches it through
 * `scripts/db/migrate.ts`.
 */
import { loadConfig } from '@robis/shared/config';
import { createDatabase } from './index.ts';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';

// Before anything else, and failing closed: see `loadConfig`. As the owner:
// migrations create and alter tables, which the runtime role cannot.
const { migrationDatabaseUrl } = loadConfig(process.env, { asOwner: true });

const { db, close } = createDatabase(migrationDatabaseUrl, { max: 1 });

try {
  await runMigrations(db);
  console.log(`Migrations applied from ${MIGRATIONS_DIR}`);
} finally {
  await close();
}
