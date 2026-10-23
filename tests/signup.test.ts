import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { signups, users } from '@robis/database';
import { TERMS_VERSION } from '@robis/shared';
import { handlers } from '@robis/worker/handlers';
import { eq } from 'drizzle-orm';
import {
  ACTOR_PASSWORD,
  closeHarness,
  createActor,
  getHarness,
  getMailer,
  request,
  resetDatabase,
  signUp,
} from './harness.ts';

/**
 * Email-first sign-up (stage 1, item 12): starting one says "check your
 * inbox" whatever the address, so the form cannot be used to learn who
 * has an account. The link in that mail is what finishes it, and opening
 * it is what proves the address, so a new account starts confirmed.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const start = (email: string) => request('/auth/signup', { method: 'POST', payload: { email } });

function linkTokenIn(text: string | undefined): string | null {
  return /\/signup\?token=([A-Za-z0-9_-]+)/.exec(text ?? '')?.[1] ?? null;
}

function finish(token: string, overrides: Record<string, unknown> = {}) {
  const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  return request('/auth/register', {
    method: 'POST',
    payload: {
      token,
      name: 'New Person',
      username: `new_${stamp}`,
      password: ACTOR_PASSWORD,
      ageConfirmed: true,
      termsVersion: TERMS_VERSION,
      ...overrides,
    },
  });
}

describe('starting a sign-up', () => {
  test('answers the same for a new address and one that has an account', async () => {
    const existing = await createActor('Existing');
    const fresh = await start(`fresh-${Date.now()}@robis.test`);
    const taken = await start(existing.email);

    expect(fresh.statusCode).toBe(202);
    expect(taken.statusCode).toBe(fresh.statusCode);
    expect(taken.json()).toEqual(fresh.json());
    expect(fresh.json() as unknown).toEqual({ status: 'check_inbox' });
  });

  test('mails a finishing link to a new address, and a reminder to a known one', async () => {
    const existing = await createActor('Existing');
    const address = `fresh-${Date.now()}@robis.test`;
    await start(address);
    await start(existing.email);

    const mailer = await getMailer();
    expect(linkTokenIn(mailer.lastTo(address)?.text)).not.toBeNull();
    const reminder = mailer.lastTo(existing.email);
    expect(linkTokenIn(reminder?.text)).toBeNull();
    expect(reminder?.text).toContain('already');
  });

  test('is limited per address, so one inbox cannot be flooded', async () => {
    const address = `flood-${Date.now()}@robis.test`;
    let last = 0;
    for (let n = 0; n < 4; n++) last = (await start(address)).statusCode;
    expect(last).toBe(429);
  });

  test('refuses something that is not an address', async () => {
    expect((await start('not an address')).statusCode).toBe(400);
  });
});

describe('finishing a sign-up', () => {
  test('creates a confirmed account from the link, with the consent recorded', async () => {
    const address = `fresh-${Date.now()}@robis.test`;
    await start(address);
    const token = linkTokenIn((await getMailer()).lastTo(address)?.text)!;

    const response = await finish(token);
    expect(response.statusCode).toBe(201);
    const cookie = String(response.headers['set-cookie']).split(';')[0]!;
    const me = (await request('/auth/me', { headers: { cookie } })).json().user;
    expect(me.email).toBe(address);
    expect(me.emailVerified).toBe(true);
    expect(me.consent.needed).toBe(false);
  });

  test('works once: the link is used up', async () => {
    const address = `fresh-${Date.now()}@robis.test`;
    await start(address);
    const token = linkTokenIn((await getMailer()).lastTo(address)?.text)!;
    expect((await finish(token)).statusCode).toBe(201);

    const again = await finish(token);
    expect(again.statusCode).toBe(400);
    expect(again.json().error).toBe('signup_link_invalid');
  });

  test('refuses an expired link', async () => {
    const address = `fresh-${Date.now()}@robis.test`;
    await start(address);
    const token = linkTokenIn((await getMailer()).lastTo(address)?.text)!;
    const { db } = await getHarness();
    await db
      .update(signups)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(signups.email, address));

    const late = await finish(token);
    expect(late.statusCode).toBe(400);
    expect(late.json().error).toBe('signup_link_invalid');
  });

  test('refuses a made-up link', async () => {
    expect((await finish('not-a-real-token')).json().error).toBe('signup_link_invalid');
  });

  test('asking again does not cancel a link already sent', async () => {
    // Anyone can type someone else's address; that must not spend the link
    // the owner is holding. Either link finishes, and only once.
    const address = `fresh-${Date.now()}@robis.test`;
    const mailer = await getMailer();
    await start(address);
    const first = linkTokenIn((await getMailer()).lastTo(address)?.text)!;
    mailer.clear();
    await start(address);
    const second = linkTokenIn((await getMailer()).lastTo(address)?.text)!;

    expect(second).not.toBe(first);
    expect((await finish(first)).statusCode).toBe(201);
    expect((await finish(second)).json().error).toBe('signup_link_invalid');
  });

  test('two finishes racing with one link make one account, and the other is told why', async () => {
    const address = `race-${Date.now()}@robis.test`;
    await start(address);
    const token = linkTokenIn((await getMailer()).lastTo(address)?.text)!;
    const [a, b] = await Promise.all([finish(token), finish(token)]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 400]);
    const loser = a.statusCode === 400 ? a : b;
    expect(loser.json().error).toBe('signup_link_invalid');
  });

  test('still refuses a taken username, which is public anyway', async () => {
    const someone = await createActor('Someone');
    const address = `fresh-${Date.now()}@robis.test`;
    await start(address);
    const token = linkTokenIn((await getMailer()).lastTo(address)?.text)!;
    const response = await finish(token, { username: someone.username });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('username_taken');
    // The link survives a refusal, so the person can pick another name.
    expect((await finish(token)).statusCode).toBe(201);
  });
});

describe('unfinished sign-ups', () => {
  test('are swept away by the housekeeping job a week after their link ran out', async () => {
    const stale = `stale-${Date.now()}@robis.test`;
    const recent = `recent-${Date.now()}@robis.test`;
    await start(stale);
    await start(recent);
    await getMailer();
    const { db } = await getHarness();
    await db
      .update(signups)
      .set({ expiresAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) })
      .where(eq(signups.email, stale));

    await handlers['sessions.cleanup']!({}, { db });

    const left = (await db.select({ email: signups.email }).from(signups)).map((r) => r.email);
    expect(left).toEqual([recent]);
  });
});

describe('the test helper', () => {
  test('signs people up the same way', async () => {
    const response = await signUp({
      email: `helper-${Date.now()}@robis.test`,
      name: 'Helper',
      username: `helper_${Date.now()}`,
      password: ACTOR_PASSWORD,
      ageConfirmed: true,
      termsVersion: TERMS_VERSION,
    });
    expect(response.statusCode).toBe(201);
    const { db } = await getHarness();
    const [row] = await db
      .select({ verifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, response.json().user.id));
    expect(row?.verifiedAt).toBeInstanceOf(Date);
  });
});
