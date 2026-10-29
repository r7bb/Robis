import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDatabase, ensureMlRole } from '@robis/database';
import { sql } from 'drizzle-orm';
import { closeHarness, getHarness, TEST_URL } from './harness.ts';

/**
 * The ML service's database access (stage 1, item 8): one view, owned by
 * the migrations, read by a role that can read nothing else.
 */

const ML_ROLE = 'robis_ml_test';
const ML_PASSWORD = 'robis-ml-test-password';

function asMlRole() {
  const url = new URL(TEST_URL);
  url.username = ML_ROLE;
  url.password = ML_PASSWORD;
  return createDatabase(url.toString(), { max: 1 });
}

beforeAll(async () => {
  const { ownerDb } = await getHarness();
  await ensureMlRole(ownerDb, { role: ML_ROLE, password: ML_PASSWORD });
});
afterAll(closeHarness);

describe('the ml_issues view', () => {
  test('has exactly the columns the ML service reads', async () => {
    const { ownerDb } = await getHarness();
    const rows = (await ownerDb.execute(sql`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'ml_issues'
      order by ordinal_position`)) as unknown as { column_name: string }[];
    expect(rows.map((r) => r.column_name)).toEqual([
      'id',
      'workspace_id',
      'title',
      'description',
      'priority',
      'created_at',
      'updated_at',
    ]);
  });
});

describe('the ML role', () => {
  test('can read the view', async () => {
    const { db, close } = asMlRole();
    try {
      const rows = (await db.execute(sql`select count(*)::int as n from ml_issues`)) as unknown as {
        n: number;
      }[];
      expect(rows[0]!.n).toBeGreaterThanOrEqual(0);
    } finally {
      await close();
    }
  });

  test('cannot read the tables, nor change the view', async () => {
    const { db, close } = asMlRole();
    const refused = [
      sql`select count(*) from issues`,
      sql`select count(*) from users`,
      sql`select count(*) from sessions`,
      sql.raw('update ml_issues set title = title'),
    ];
    try {
      for (const query of refused) {
        let error = '';
        try {
          await db.execute(query);
        } catch (caught) {
          error = String(caught);
        }
        expect(error).toMatch(/permission denied/);
      }
    } finally {
      await close();
    }
  });
});
