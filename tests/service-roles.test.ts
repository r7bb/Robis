import { afterAll, describe, expect, test } from 'bun:test';
import type { Database } from '@robis/database';
import { type SQL, sql } from 'drizzle-orm';
import { closeHarness, getHarness } from './harness.ts';

/**
 * The gateway and the worker each connect as a role of their own (stage 1,
 * item 8), granted what their code does and nothing else. Their test suites
 * already run as them, so a missing grant fails there; this checks the
 * other side: what each is refused.
 */

afterAll(closeHarness);

async function refused(db: Database, query: SQL): Promise<boolean> {
  try {
    await db.execute(query);
    return false;
  } catch (error) {
    return /permission denied/.test(String(error));
  }
}

describe('the gateway', () => {
  test('cannot change issues, people or memberships, nor read the audit trail', async () => {
    const { gatewayDb } = await getHarness();
    for (const query of [
      sql.raw('update issues set title = title'),
      sql.raw('update users set name = name'),
      sql.raw(
        'insert into workspace_members (workspace_id, user_id) values (gen_random_uuid(), gen_random_uuid())',
      ),
      sql.raw('select count(*) from audit_events'),
      sql.raw('select count(*) from jobs'),
    ]) {
      expect(await refused(gatewayDb, query)).toBe(true);
    }
  });
});

describe('the worker', () => {
  test('cannot change issues, people or the audit trail, nor read document contents', async () => {
    const { workerDb } = await getHarness();
    for (const query of [
      sql.raw('update issues set title = title'),
      sql.raw('update users set name = name'),
      sql.raw('update audit_events set seq = seq'),
      sql.raw('update workspace_members set role = role'),
      sql.raw('select count(*) from document_updates'),
    ]) {
      expect(await refused(workerDb, query)).toBe(true);
    }
  });
});
