import { afterAll, describe, expect, test } from 'bun:test';
import { createDatabase } from '@robis/database';
import { closeHarness, resetDatabaseWithin, TEST_URL } from './harness.ts';

/**
 * Emptying the tables between tests needs every table to itself. When a
 * session left a transaction open, the reset used to wait for it until the
 * hook timed out, fifteen minutes later, saying nothing about why. It now
 * gives up quickly and names the session in its way.
 */

afterAll(closeHarness);

describe('resetting the database', () => {
  test('gives up quickly on a held lock, and says who holds it', async () => {
    const other = createDatabase(TEST_URL, { max: 1 });
    let release = () => {};
    const held = other.db.transaction(async (tx) => {
      await tx.execute('lock table users in access share mode');
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    try {
      // Let the other session take its lock first.
      await Bun.sleep(200);
      const started = Date.now();
      const error = await resetDatabaseWithin('500ms').then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(Error);
      expect(Date.now() - started).toBeLessThan(10_000);
      expect((error as Error).message).toContain('lock table users in access share mode');
    } finally {
      release();
      await held;
      await other.close();
    }
  });
});
