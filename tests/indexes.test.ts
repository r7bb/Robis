import { afterAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { closeHarness, getHarness } from './harness.ts';

/**
 * Indexes for the two queries that run on a clock (stage 3, item 29): the
 * worker claiming due jobs, and the hourly removal of expired sessions.
 */

afterAll(closeHarness);

async function indexDefinition(name: string): Promise<string | null> {
  const { ownerDb } = await getHarness();
  const rows = (await ownerDb.execute(
    sql`select indexdef from pg_indexes where schemaname = 'public' and indexname = ${name}`,
  )) as unknown as { indexdef: string }[];
  return rows[0]?.indexdef ?? null;
}

/** The plan Postgres picks with sequential scans ruled out: which index it can use. */
async function plan(query: string): Promise<string> {
  const { ownerDb } = await getHarness();
  return ownerDb.transaction(async (tx) => {
    await tx.execute(sql.raw('set local enable_seqscan = off'));
    const rows = (await tx.execute(sql.raw(`explain ${query}`))) as unknown as {
      'QUERY PLAN': string;
    }[];
    return rows.map((row) => row['QUERY PLAN']).join('\n');
  });
}

describe('indexes for the queries on a clock', () => {
  test('pending jobs are indexed by when they are due, and only pending ones', async () => {
    const definition = await indexDefinition('jobs_pending_run_at_idx');
    expect(definition).toContain('(run_at)');
    expect(definition).toContain("WHERE (status = 'pending'::text)");
    // The old two-column index over every job, finished ones too, is gone.
    expect(await indexDefinition('jobs_claim_idx')).toBeNull();
  });

  test('the claim query uses it', async () => {
    const claim = await plan(
      "select id from jobs where status = 'pending' and run_at <= now() order by run_at limit 5",
    );
    expect(claim).toContain('jobs_pending_run_at_idx');
  });

  test('sessions are indexed by expiry, and the cleanup uses it', async () => {
    expect(await indexDefinition('sessions_expires_at_idx')).toContain('(expires_at)');
    const cleanup = await plan('delete from sessions where expires_at < now()');
    expect(cleanup).toContain('sessions_expires_at_idx');
  });
});
