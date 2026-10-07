import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { closeHarness, createActor, getMailer, request, resetDatabase } from './harness.ts';

/**
 * Email verification.
 *
 * Nothing in Relay is gated on a verified address yet -- see the README -- so
 * what these tests protect is the integrity of the claim itself: the link is
 * single-use, cannot be spent on another account, and cannot be spent as a
 * password reset.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const verify = (token: string) =>
  request('/auth/email/verify', { method: 'POST', payload: { token } });

async function verificationTokenFor(email: string): Promise<string> {
  const mail = (await getMailer()).lastTo(email);
  if (!mail) throw new Error(`no mail sent to ${email}`);

  const match = /verify-email\?token=([A-Za-z0-9_-]+)/.exec(mail.text);
  if (!match) throw new Error(`no verification link in:\n${mail.text}`);
  return match[1]!;
}

describe('registering', () => {
  test('sends a verification link', async () => {
    const actor = await createActor('Newcomer');

    const mail = (await getMailer()).lastTo(actor.email);
    expect(mail?.subject).toMatch(/verif/i);
    expect(mail?.text).toContain('/verify-email?token=');
  });

  test('leaves the account unverified until the link is used', async () => {
    const actor = await createActor('Newcomer');

    const me = (await request('/auth/me', { actor })).json();
    expect(me.user.emailVerified).toBe(false);
  });

  /** An unverified address must not block anything today. */
  test('an unverified account can still do its work', async () => {
    const actor = await createActor('Newcomer');

    const created = await request('/workspaces', {
      method: 'POST',
      payload: { name: 'Unverified but working' },
      actor,
    });

    expect(created.statusCode).toBe(201);
  });
});

describe('verifying', () => {
  test('marks the address as verified', async () => {
    const actor = await createActor('Newcomer');
    const token = await verificationTokenFor(actor.email);

    expect((await verify(token)).statusCode).toBe(200);

    const me = (await request('/auth/me', { actor })).json();
    expect(me.user.emailVerified).toBe(true);
  });

  test('needs no session, since the link is the proof', async () => {
    const actor = await createActor('Newcomer');
    const token = await verificationTokenFor(actor.email);

    // Clicking from a mail client means arriving signed out.
    expect((await verify(token)).statusCode).toBe(200);
  });

  test('works exactly once', async () => {
    const actor = await createActor('Newcomer');
    const token = await verificationTokenFor(actor.email);

    expect((await verify(token)).statusCode).toBe(200);
    expect((await verify(token)).statusCode).toBe(400);
  });

  test('an unknown token is refused', async () => {
    await createActor('Newcomer');

    expect((await verify('not-a-real-token')).statusCode).toBe(400);
  });

  /**
   * A verification link sits in an inbox and is the easiest token to obtain,
   * so it must not be spendable on the flow that changes a password.
   */
  test('cannot be spent as a password reset', async () => {
    const actor = await createActor('Newcomer');
    const token = await verificationTokenFor(actor.email);

    const misused = await request('/auth/password/reset', {
      method: 'POST',
      payload: { token, newPassword: 'hijacked-password-here' },
    });

    expect(misused.statusCode).toBe(400);
    // And the original password still works.
    const login = await request('/auth/login', {
      method: 'POST',
      payload: { email: actor.email, password: 'correct-horse-battery-staple' },
    });
    expect(login.statusCode).toBe(200);
  });
});

describe('resending', () => {
  test('issues a fresh link and retires the previous one', async () => {
    const actor = await createActor('Newcomer');
    const first = await verificationTokenFor(actor.email);

    const resent = await request('/auth/email/resend', { method: 'POST', actor });
    expect(resent.statusCode).toBe(200);

    const second = await verificationTokenFor(actor.email);
    expect(second).not.toBe(first);
    expect((await verify(first)).statusCode).toBe(400);
    expect((await verify(second)).statusCode).toBe(200);
  });

  test('requires a session', async () => {
    await createActor('Newcomer');

    // Without one this would be an open mail-sending endpoint keyed on any
    // address an attacker chose.
    expect((await request('/auth/email/resend', { method: 'POST' })).statusCode).toBe(401);
  });

  test('is a no-op once the address is verified', async () => {
    const actor = await createActor('Newcomer');
    await verify(await verificationTokenFor(actor.email));

    const mailer = await getMailer();
    mailer.clear();

    const response = await request('/auth/email/resend', { method: 'POST', actor });

    expect(response.json().alreadyVerified).toBe(true);
    expect(mailer.sent).toEqual([]);
  });
});
