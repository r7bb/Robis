import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { eraseSubject, erasures } from '@robis/database';
import { sql } from 'drizzle-orm';
import {
  addMember,
  closeHarness,
  createActor,
  createWorkspace,
  databaseMessage,
  getHarness,
  resetDatabase,
} from './harness.ts';

/**
 * Erasure (stage 1, item 9): only `audit:erase`'s own role can blank the
 * audit trail's personal fields, and every erasure leaves a record of how
 * much it removed and a commitment to whom, never the person themselves.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

async function memberWithHistory() {
  const owner = await createActor('Owner');
  const member = await createActor('Member');
  const workspace = await createWorkspace(owner);
  await addMember(owner, workspace.id, member, 'MEMBER');
  return member;
}

describe('the app role', () => {
  test('cannot erase anyone, nor read or write the erasure record', async () => {
    const { db } = await getHarness();
    for (const query of [
      sql.raw('update audit_events set personal = null'),
      sql.raw('select count(*) from erasures'),
      sql.raw(
        "insert into erasures (commitment, audit_events_erased, usernames_forgotten) values ('x', 0, 0)",
      ),
    ]) {
      let error = '';
      try {
        await db.execute(query);
      } catch (caught) {
        error = databaseMessage(caught);
      }
      expect(error).toMatch(/permission denied/);
    }
  });
});

describe('an erasure', () => {
  test('blanks the person’s fields and records only a commitment and counts', async () => {
    const member = await memberWithHistory();
    const { eraserDb, ownerDb } = await getHarness();

    const result = await eraseSubject(eraserDb, member.id);
    expect(result.auditEventsErased).toBeGreaterThan(0);

    const [record] = await ownerDb.select().from(erasures);
    expect(record).toMatchObject({
      auditEventsErased: result.auditEventsErased,
      usernamesForgotten: result.usernamesForgotten,
    });
    // The commitment binds the record to the person only with the nonce,
    // which the operator keeps with the request; the record alone names no one.
    expect(record!.commitment).toBe(
      createHash('sha256').update(`robis-erasure|${member.id}|${result.nonce}`).digest('hex'),
    );
    expect(JSON.stringify(record)).not.toContain(member.id);

    const left = (await ownerDb.execute(
      sql`select count(*)::int as n from audit_events where personal_subject_id = ${member.id}`,
    )) as unknown as { n: number }[];
    expect(left[0]!.n).toBe(0);
  });
});
