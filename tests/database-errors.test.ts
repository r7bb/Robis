import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { pgErrorCode, users } from '@robis/database';
import { eq, sql } from 'drizzle-orm';
import { closeHarness, createActor, getHarness, resetDatabase } from './harness.ts';

/**
 * The code Postgres gave a failed query, however the driver or Drizzle
 * wrapped it (stage 2, item 22). Drizzle 0.44 began wrapping query errors,
 * with the database's own error as the cause; code that read `.code` off
 * the error it caught would have stopped recognising a unique violation.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

async function failure(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the query to fail');
}

describe('postgres error codes', () => {
  test('a unique violation is 23505 through the query builder', async () => {
    const { db } = await getHarness();
    const taken = await createActor('Taken');
    const other = await createActor('Other');
    const error = await failure(() =>
      db.update(users).set({ username: taken.username }).where(eq(users.id, other.id)),
    );
    expect(pgErrorCode(error)).toBe('23505');
  });

  test('a missing reference is 23503 through raw SQL', async () => {
    const { db } = await getHarness();
    const error = await failure(() =>
      db.execute(
        sql`insert into workspace_members (workspace_id, user_id) values (gen_random_uuid(), gen_random_uuid())`,
      ),
    );
    expect(pgErrorCode(error)).toBe('23503');
  });

  test('anything that is not a database error has no code', () => {
    expect(pgErrorCode(new Error('plain'))).toBeUndefined();
    expect(pgErrorCode(undefined)).toBeUndefined();
    expect(pgErrorCode({ code: 'ERR_S3_FILE_NOT_FOUND' })).toBeUndefined();
  });
});
