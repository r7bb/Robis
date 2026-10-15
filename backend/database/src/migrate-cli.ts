/**
 * Apply every migration file, then exit.
 *
 * Lives in this package so it runs wherever the package is installed: in a
 * container only workspace packages can resolve `@robis/database`, so the
 * image runs this file directly. `bun run db:migrate` reaches it through
 * `scripts/db/migrate.ts`.
 */
import { createDatabase } from './index.ts';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';

// The owner: migrations create and alter tables, which the application's
// runtime role cannot (see roles.ts).
const DATABASE_URL =
  process.env.MIGRATION_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://robis:robis@localhost:5433/robis';

const { db, close } = createDatabase(DATABASE_URL, { max: 1 });

try {
  await runMigrations(db);
  console.log(`Migrations applied from ${MIGRATIONS_DIR}`);
} finally {
  await close();
}
