import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { accountEvents, verifyAccountChain } from '@robis/database';
import { asc, eq, sql } from 'drizzle-orm';
import {
  type Actor,
  closeHarness,
  createActor,
  getHarness,
  getMailer,
  refusal,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * Each account's own trail: what happened to the account, signed and
 * chained like a workspace's, and readable only by its holder.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const PASSWORD = 'correct-horse-battery-staple';

async function trailOf(userId: string) {
  const { db } = await getHarness();
  return db
    .select()
    .from(accountEvents)
    .where(eq(accountEvents.userId, userId))
    .orderBy(asc(accountEvents.seq));
}

const types = async (userId: string) => (await trailOf(userId)).map((event) => event.eventType);

/** Every account's trail starts with agreeing to the terms at sign-up. */
const SIGNED_UP = ['auth.terms_accepted'];

const login = (email: string, password: string) =>
  request('/auth/login', { method: 'POST', payload: { email, password } });

/** A failed sign-in is written after the reply, so wait for it to land. */
async function eventually(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await check()) return;
    await Bun.sleep(20);
  }
  throw new Error('condition never held');
}

describe('what is recorded', () => {
  test('signing in, and out', async () => {
    const actor = await createActor('Holder');
    expect((await login(actor.email, PASSWORD)).statusCode).toBe(200);
    await request('/auth/logout', { method: 'POST', actor });

    expect(await types(actor.id)).toEqual([...SIGNED_UP, 'auth.signed_in', 'auth.signed_out']);
  });

  test('a failed sign-in, for a real account only', async () => {
    const actor = await createActor('Holder');
    expect((await login(actor.email, 'not the password')).statusCode).toBe(401);
    await eventually(async () => (await types(actor.id)).includes('auth.sign_in_failed'));

    // No account, no trail: nothing is written anywhere for an unknown address.
    const { db } = await getHarness();
    const before = await db.select({ n: sql<number>`count(*)::int` }).from(accountEvents);
    expect((await login('nobody@robis.test', 'whatever')).statusCode).toBe(401);
    await Bun.sleep(100);
    const after = await db.select({ n: sql<number>`count(*)::int` }).from(accountEvents);
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  test('a burst of wrong passwords is one entry, not one each', async () => {
    const actor = await createActor('Holder');
    for (let n = 0; n < 4; n++) await login(actor.email, 'not the password');
    await eventually(async () => (await types(actor.id)).includes('auth.sign_in_failed'));
    await Bun.sleep(100);

    expect(await types(actor.id)).toEqual([...SIGNED_UP, 'auth.sign_in_failed']);
  });

  test('signing out other sessions when there are none records nothing', async () => {
    const actor = await createActor('Holder');
    await request('/auth/sessions', { method: 'DELETE', actor });
    expect(await types(actor.id)).toEqual(SIGNED_UP);
  });

  test('changing the password, and revoking other sessions', async () => {
    const actor = await createActor('Holder');
    await login(actor.email, PASSWORD);
    await request('/auth/sessions', { method: 'DELETE', actor });

    const changed = await request('/auth/password', {
      method: 'POST',
      actor,
      payload: { currentPassword: PASSWORD, newPassword: 'a-completely-different-password' },
    });
    expect(changed.statusCode).toBe(200);

    const trail = await trailOf(actor.id);
    expect(trail.map((event) => event.eventType)).toEqual([
      ...SIGNED_UP,
      'auth.signed_in',
      'auth.sessions_revoked',
      'auth.password_changed',
    ]);
    expect(JSON.parse(trail[2]!.payload)).toEqual({ count: 1 });
  });

  test('resetting the password from an emailed link', async () => {
    const actor = await createActor('Holder');
    await request('/auth/password/forgot', { method: 'POST', payload: { email: actor.email } });
    const mail = (await getMailer()).lastTo(actor.email)!;
    const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)![1];

    await request('/auth/password/reset', {
      method: 'POST',
      payload: { token, newPassword: 'a-completely-different-password' },
    });
    expect(await types(actor.id)).toEqual([...SIGNED_UP, 'auth.password_reset']);
  });

  test('nothing about where: no address, location or device is kept', async () => {
    const actor = await createActor('Holder');
    await login(actor.email, PASSWORD);
    const event = (await trailOf(actor.id)).find((row) => row.eventType === 'auth.signed_in');
    expect(JSON.parse(event!.payload)).toEqual({});
  });
});

describe('who can see it', () => {
  test('the holder sees their own events, newest first', async () => {
    const actor = await createActor('Holder');
    await login(actor.email, PASSWORD);
    await request('/auth/sessions', { method: 'DELETE', actor });

    const response = await request('/auth/me/events', { actor });
    expect(response.statusCode).toBe(200);
    expect(response.json().events.map((event: { type: string }) => event.type)).toEqual([
      'auth.sessions_revoked',
      'auth.signed_in',
      ...SIGNED_UP,
    ]);
  });

  test('nobody else does', async () => {
    const holder = await createActor('Holder');
    const other: Actor = await createActor('Other');
    await login(holder.email, PASSWORD);

    // Only their own sign-up: nothing of the holder's.
    const theirs = (await request('/auth/me/events', { actor: other })).json().events;
    expect(theirs.map((event: { type: string }) => event.type)).toEqual(SIGNED_UP);
    expect((await request('/auth/me/events')).statusCode).toBe(401);
  });
});

describe('the chain', () => {
  test('an intact trail verifies', async () => {
    const actor = await createActor('Holder');
    await login(actor.email, PASSWORD);
    await login(actor.email, PASSWORD);

    const response = await request('/auth/me/events/verify', { method: 'POST', actor });
    const body: unknown = response.json();
    expect(body).toEqual({ ok: true, checked: 3, broken: null });
  });

  test('an edited event is named', async () => {
    const { db, ownerDb } = await getHarness();
    const actor = await createActor('Holder');
    await login(actor.email, PASSWORD);
    await login(actor.email, PASSWORD);

    await ownerDb.transaction(async (tx) => {
      await tx.execute(sql`alter table account_events disable trigger account_events_append_only`);
      await tx.execute(
        sql`update account_events set event_type = 'auth.signed_out'
            where user_id = ${actor.id} and seq = 1`,
      );
      await tx.execute(sql`alter table account_events enable trigger account_events_append_only`);
    });

    expect(await verifyAccountChain(db, actor.id)).toMatchObject({
      ok: false,
      broken: { seq: 1, reason: 'altered' },
    });
  });

  test('the runtime role cannot change or remove an event', async () => {
    const { db } = await getHarness();
    const actor = await createActor('Holder');
    await login(actor.email, PASSWORD);
    const run = async (statement: ReturnType<typeof sql>) => db.execute(statement);

    expect(
      await refusal(run(sql`update account_events set payload = '{}' where user_id = ${actor.id}`)),
    ).toMatch(/permission denied/);
    expect(await refusal(run(sql`delete from account_events where user_id = ${actor.id}`))).toMatch(
      /permission denied/,
    );
  });
});
