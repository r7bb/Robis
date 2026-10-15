/**
 * Apply migration files to a database.
 *
 *   bun run db:migrate
 *
 * This is the path dev should use, not `drizzle-kit push`. `push` diffs the
 * schema straight onto the database and is convenient while iterating, but it
 * means development runs SQL that CI and the tests never execute -- and the
 * tests apply these files. That divergence already hid one bug: a unique index
 * present in the migration was missing from a pushed dev database, so the
 * mention handler failed on `ON CONFLICT` in dev while passing every test.
 */
// The command itself lives in the database package; see migrate-cli.ts.
import '@robis/database/migrate-cli';
