import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { SESSION_COOKIE } from '@robis/auth';
import {
  type Actor,
  closeHarness,
  createActor,
  getMailer,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * Forgotten-password flow.
 *
 * Two properties carry this suite. The first is that the response never
 * reveals whether an address has an account -- the endpoint is otherwise a
 * free account-existence oracle for anyone with a list of addresses. The
 * second is that a reset link is a credential: short-lived, single-use, and
 * able to be invalidated.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const PASSWORD = 'correct-horse-battery-staple';
const NEW_PASSWORD = 'a-completely-different-password';

const forgot = (email: string) =>
  request('/auth/password/forgot', { method: 'POST', payload: { email } });

const reset = (token: string, newPassword = NEW_PASSWORD) =>
  request('/auth/password/reset', { method: 'POST', payload: { token, newPassword } });

const login = (email: string, password: string) =>
  request('/auth/login', { method: 'POST', payload: { email, password } });

/** Pull the token out of the message, the way a person clicking the link would. */
async function tokenMailedTo(email: string): Promise<string> {
  const mail = (await getMailer()).lastTo(email);
  if (!mail) throw new Error(`no mail sent to ${email}`);

  const match = /token=([A-Za-z0-9_-]+)/.exec(mail.text);
  if (!match) throw new Error(`no token in mail body:\n${mail.text}`);
  return match[1]!;
}

describe('asking for a link', () => {
  test('a known address is accepted and mailed', async () => {
    const actor = await createActor('Holder');

    const response = await forgot(actor.email);

    expect(response.statusCode).toBe(202);
    expect((await getMailer()).lastTo(actor.email)).toBeDefined();
  });

  /**
   * The property the endpoint lives or dies by: an attacker with a list of
   * addresses must not be able to learn which ones are registered.
   */
  test('an unknown address gets the identical response', async () => {
    const actor = await createActor('Holder');

    const known = await forgot(actor.email);
    const unknown = await forgot('nobody-at-all@robis.invalid');

    expect(unknown.statusCode).toBe(known.statusCode);
    expect(unknown.body).toBe(known.body);
  });

  test('and no mail is sent for an address with no account', async () => {
    await forgot('nobody-at-all@robis.invalid');

    expect((await getMailer()).sent).toEqual([]);
  });

  /** A malformed address must not be distinguishable either. */
  test('a malformed address gets the same response, not a validation error', async () => {
    const actor = await createActor('Holder');

    const valid = await forgot(actor.email);
    const malformed = await forgot('not-an-email');

    expect(malformed.statusCode).toBe(valid.statusCode);
    expect(malformed.body).toBe(valid.body);
  });

  test('the address is matched case-insensitively', async () => {
    const actor = await createActor('Holder');

    await forgot(actor.email.toUpperCase());

    expect((await getMailer()).lastTo(actor.email)).toBeDefined();
  });

  test('the mail carries a working link', async () => {
    const actor = await createActor('Holder');
    await forgot(actor.email);

    const mail = (await getMailer()).lastTo(actor.email)!;
    expect(mail.text).toContain('/reset-password?token=');

    const token = await tokenMailedTo(actor.email);
    expect((await reset(token)).statusCode).toBe(200);
  });

  /** A second request must retire the first link, not run alongside it. */
  test('asking twice invalidates the first link', async () => {
    const actor = await createActor('Holder');

    await forgot(actor.email);
    const first = await tokenMailedTo(actor.email);

    await forgot(actor.email);
    const second = await tokenMailedTo(actor.email);

    expect(second).not.toBe(first);
    expect((await reset(first)).statusCode).toBe(400);
    expect((await reset(second)).statusCode).toBe(200);
  });
});

describe('spending a link', () => {
  async function requested(): Promise<{ actor: Actor; token: string }> {
    const actor = await createActor('Holder');
    await forgot(actor.email);
    return { actor, token: await tokenMailedTo(actor.email) };
  }

  test('sets the new password and retires the old one', async () => {
    const { actor, token } = await requested();

    expect((await reset(token)).statusCode).toBe(200);
    expect((await login(actor.email, PASSWORD)).statusCode).toBe(401);
    expect((await login(actor.email, NEW_PASSWORD)).statusCode).toBe(200);
  });

  test('works exactly once', async () => {
    const { token } = await requested();

    expect((await reset(token)).statusCode).toBe(200);
    expect((await reset(token, 'yet-another-password')).statusCode).toBe(400);
  });

  /**
   * Whoever reset the password may be recovering from a compromise, so every
   * existing session has to go -- including one an attacker is holding.
   */
  test('signs out every existing session', async () => {
    const { actor, token } = await requested();

    // The actor's own cookie proves a live session exists beforehand.
    expect((await request('/auth/me', { actor })).statusCode).toBe(200);

    await reset(token);

    expect((await request('/auth/me', { actor })).statusCode).toBe(401);
  });

  test('does not sign the caller in', async () => {
    const { token } = await requested();

    // Holding a mailed link is not proof of identity the way a password is;
    // the next step is the login form.
    const response = await reset(token);
    expect(response.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
  });

  test('a short password is refused and the link survives', async () => {
    const { token } = await requested();

    expect((await reset(token, 'short')).statusCode).toBe(400);
    // Fat-fingering the new password must not cost the link.
    expect((await reset(token)).statusCode).toBe(200);
  });

  test('an unknown token is refused', async () => {
    await requested();

    expect((await reset('completely-made-up-token')).statusCode).toBe(400);
  });

  /**
   * "Expired" and "never existed" must read the same, or the response confirms
   * that a token once existed for that account.
   */
  test('an unknown and a spent token are indistinguishable', async () => {
    const { token } = await requested();
    await reset(token);

    const spent = await reset(token);
    const unknown = await reset('completely-made-up-token');

    expect(spent.statusCode).toBe(unknown.statusCode);
    expect(spent.body).toBe(unknown.body);
  });

  test('one account link cannot change another account password', async () => {
    const { token } = await requested();
    const other = await createActor('Other');

    await reset(token);

    // The token named its own owner, so the stranger is untouched.
    expect((await login(other.email, PASSWORD)).statusCode).toBe(200);
  });
});

/**
 * Properties the security review added.
 *
 * Each of these was a real finding, so each gets a test that fails if the fix
 * is removed.
 */
describe('hardening', () => {
  /**
   * The response time used to say whether the address existed: a known address
   * did an upsert plus a send, an unknown one returned straight after the
   * select. A floor makes every reply cost the same.
   */
  test('a known and an unknown address take comparably long', async () => {
    const actor = await createActor('Holder');

    const timeOf = async (email: string) => {
      const started = performance.now();
      await forgot(email);
      return performance.now() - started;
    };

    const known = await timeOf(actor.email);
    const unknown = await timeOf('nobody-at-all@robis.invalid');

    // Both are held to the same floor, so neither is a usable signal. A
    // generous bound: this asserts the floor exists, not that the clock is
    // quiet on a loaded machine.
    expect(Math.abs(known - unknown)).toBeLessThan(250);
    expect(Math.min(known, unknown)).toBeGreaterThan(300);
  });

  /**
   * The caller-keyed limit does not protect the person being mailed, because
   * the attacker picks the address.
   */
  test('one address cannot be mail-bombed', async () => {
    const actor = await createActor('Victim');

    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push((await forgot(actor.email)).statusCode);
    }

    // The budget is 3 an hour per address, so the later ones are refused.
    expect(codes.filter((code) => code === 202).length).toBeLessThanOrEqual(3);
    expect(codes).toContain(429);
  });

  test('throttling one address leaves another alone', async () => {
    const victim = await createActor('Victim');
    const other = await createActor('Other');

    for (let i = 0; i < 5; i++) await forgot(victim.email);

    expect((await forgot(other.email)).statusCode).toBe(202);
  });

  /**
   * Issuing used to delete then insert, which let two concurrent requests
   * both insert and leave two live links.
   */
  test('concurrent requests leave exactly one live link', async () => {
    const actor = await createActor('Holder');

    await Promise.all([forgot(actor.email), forgot(actor.email), forgot(actor.email)]);

    const { authTokens } = await import('@robis/database');
    const { and, eq } = await import('drizzle-orm');
    const { db } = await import('./harness.ts').then((m) => m.getHarness());

    const rows = await db
      .select({ id: authTokens.id })
      .from(authTokens)
      .where(and(eq(authTokens.userId, actor.id), eq(authTokens.purpose, 'password_reset')));

    expect(rows).toHaveLength(1);
  });

  /**
   * Someone who changes their password because their mailbox was exposed
   * should not be left with a live reset link that undoes it.
   */
  test('changing a password retires any outstanding reset link', async () => {
    const actor = await createActor('Holder');

    await forgot(actor.email);
    const token = await tokenMailedTo(actor.email);

    const changed = await request('/auth/password', {
      method: 'POST',
      payload: { currentPassword: PASSWORD, newPassword: 'chosen-deliberately-today' },
      actor,
    });
    expect(changed.statusCode).toBe(200);

    // The emailed link is now dead.
    expect((await reset(token)).statusCode).toBe(400);
  });
});
