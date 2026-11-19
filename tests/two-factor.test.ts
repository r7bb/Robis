import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { base32Decode, totpAt, totpStep } from '@robis/auth';
import { ACTOR_PASSWORD, closeHarness, createActor, request, resetDatabase } from './harness.ts';

/**
 * Two-factor sign-in (C4). Done when: a code works once within its window,
 * each recovery code works once, and the password alone no longer signs in.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

type Actor = Awaited<ReturnType<typeof createActor>>;

/** The code an authenticator app shows for this secret, `ahead` steps from now. */
const codeFor = (secret: string, ahead = 0) => totpAt(base32Decode(secret)!, totpStep() + ahead);

async function turnOn(actor: Actor) {
  const setup = await request('/auth/two-factor/setup', {
    method: 'POST',
    actor,
    payload: { password: ACTOR_PASSWORD },
  });
  expect(setup.statusCode).toBe(200);
  const { secret, uri } = setup.json();
  const enabled = await request('/auth/two-factor/enable', {
    method: 'POST',
    actor,
    payload: { code: codeFor(secret) },
  });
  expect(enabled.statusCode).toBe(200);
  return {
    secret: secret as string,
    uri: uri as string,
    codes: enabled.json().recoveryCodes as string[],
  };
}

const passwordStep = (actor: Actor) =>
  request('/auth/login', {
    method: 'POST',
    payload: { email: actor.email, password: ACTOR_PASSWORD },
  });

async function signIn(actor: Actor, code: string) {
  const first = await passwordStep(actor);
  const { challenge } = first.json().twoFactor;
  return request('/auth/login/two-factor', { method: 'POST', payload: { challenge, code } });
}

describe('setting up two-factor sign-in', () => {
  test('asks for the password, then gives a secret and an otpauth address naming the username', async () => {
    const ada = await createActor('Ada');
    const wrong = await request('/auth/two-factor/setup', {
      method: 'POST',
      actor: ada,
      payload: { password: 'not it' },
    });
    expect(wrong.statusCode).toBe(403);

    const { secret, uri, codes } = await turnOn(ada);
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(uri).toContain(`otpauth://totp/Robis:${ada.username}`);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
  });

  test('a wrong first code does not turn it on', async () => {
    const ada = await createActor('Ada');
    await request('/auth/two-factor/setup', {
      method: 'POST',
      actor: ada,
      payload: { password: ACTOR_PASSWORD },
    });
    const enabled = await request('/auth/two-factor/enable', {
      method: 'POST',
      actor: ada,
      payload: { code: '000000' },
    });
    expect(enabled.statusCode).toBe(400);
    const state = await request('/auth/two-factor', { actor: ada });
    expect(state.json()).toMatchObject({ available: true, enabled: false });
  });

  test('once on, it says so, with the recovery codes left', async () => {
    const ada = await createActor('Ada');
    await turnOn(ada);
    const state = await request('/auth/two-factor', { actor: ada });
    expect(state.json()).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });
    const again = await request('/auth/two-factor/setup', {
      method: 'POST',
      actor: ada,
      payload: { password: ACTOR_PASSWORD },
    });
    expect(again.statusCode).toBe(409);
  });
});

describe('signing in with it on', () => {
  test('the password alone gives a challenge and no session', async () => {
    const ada = await createActor('Ada');
    await turnOn(ada);
    const first = await passwordStep(ada);
    expect(first.statusCode).toBe(200);
    expect(first.json().user).toBeUndefined();
    expect(first.json().twoFactor.challenge).toBeString();
    expect(first.headers['set-cookie']).toBeUndefined();
  });

  test('a code works once within its window', async () => {
    const ada = await createActor('Ada');
    const { secret } = await turnOn(ada);

    // The step used to turn it on is spent already.
    expect((await signIn(ada, codeFor(secret))).statusCode).toBe(401);
    // The next step's code is taken (a clock a little ahead), once.
    const next = await signIn(ada, codeFor(secret, 1));
    expect(next.statusCode).toBe(200);
    expect(next.json().user.email).toBe(ada.email);
    expect(String(next.headers['set-cookie'])).toContain('robis_session');
    expect((await signIn(ada, codeFor(secret, 1))).statusCode).toBe(401);
  });

  test('a code from outside the window is refused', async () => {
    const ada = await createActor('Ada');
    const { secret } = await turnOn(ada);
    expect((await signIn(ada, codeFor(secret, 3))).statusCode).toBe(401);
    expect((await signIn(ada, codeFor(secret, -3))).statusCode).toBe(401);
  });

  test('each recovery code works once, in any case and spacing', async () => {
    const ada = await createActor('Ada');
    const { codes } = await turnOn(ada);
    const [first, second] = codes;

    const used = await signIn(ada, first!.toLowerCase().replace(/-/g, ' '));
    expect(used.statusCode).toBe(200);
    expect((await signIn(ada, first!)).statusCode).toBe(401);
    expect((await signIn(ada, second!)).statusCode).toBe(200);

    const state = await request('/auth/two-factor', { actor: ada });
    expect(state.json().recoveryCodesLeft).toBe(8);
  });

  test('five wrong codes end the challenge', async () => {
    const ada = await createActor('Ada');
    const { secret } = await turnOn(ada);
    const first = await passwordStep(ada);
    const { challenge } = first.json().twoFactor;
    const attempt = (code: string) =>
      request('/auth/login/two-factor', { method: 'POST', payload: { challenge, code } });

    for (let i = 0; i < 4; i++) expect((await attempt('000000')).json().error).toBe('bad_code');
    expect((await attempt('000000')).json().error).toBe('challenge_spent');
    // Even the right code is now too late for this challenge.
    expect((await attempt(codeFor(secret, 1))).statusCode).toBe(401);
  });

  test('a made-up challenge is refused', async () => {
    const response = await request('/auth/login/two-factor', {
      method: 'POST',
      payload: { challenge: 'nonsense', code: '123456' },
    });
    expect(response.statusCode).toBe(401);
  });

  test('an account without two-factor signs in as before', async () => {
    const ada = await createActor('Ada');
    const first = await passwordStep(ada);
    expect(first.json().user.email).toBe(ada.email);
  });
});

describe('guessing codes', () => {
  test('a new sign-in replaces the half-done one', async () => {
    const ada = await createActor('Ada');
    const { secret } = await turnOn(ada);
    const old = (await passwordStep(ada)).json().twoFactor.challenge;
    await passwordStep(ada);
    const late = await request('/auth/login/two-factor', {
      method: 'POST',
      payload: { challenge: old, code: codeFor(secret, 1) },
    });
    expect(late.statusCode).toBe(401);
  });

  test('ten wrong codes make the account wait, across new challenges', async () => {
    const ada = await createActor('Ada');
    const { secret } = await turnOn(ada);
    for (let round = 0; round < 2; round++) {
      const { challenge } = (await passwordStep(ada)).json().twoFactor;
      for (let i = 0; i < 5; i++) {
        await request('/auth/login/two-factor', {
          method: 'POST',
          payload: { challenge, code: '000000' },
        });
      }
    }
    // Even the right code waits now.
    const waiting = await signIn(ada, codeFor(secret, 1));
    expect(waiting.statusCode).toBe(429);
    expect(waiting.json().error).toBe('too_many_codes');
  });

  test('a changed password ends any half-done sign-in', async () => {
    const ada = await createActor('Ada');
    const { secret } = await turnOn(ada);
    const { challenge } = (await passwordStep(ada)).json().twoFactor;
    const changed = await request('/auth/password', {
      method: 'POST',
      actor: ada,
      payload: { currentPassword: ACTOR_PASSWORD, newPassword: 'a-new-long-password-for-ada' },
    });
    expect(changed.statusCode).toBe(200);
    const late = await request('/auth/login/two-factor', {
      method: 'POST',
      payload: { challenge, code: codeFor(secret, 1) },
    });
    expect(late.statusCode).toBe(401);
  });
});

describe('changing it', () => {
  test('new recovery codes need the password and a code, and replace the old', async () => {
    const ada = await createActor('Ada');
    const { secret, codes } = await turnOn(ada);
    const noCode = await request('/auth/two-factor/recovery-codes', {
      method: 'POST',
      actor: ada,
      payload: { password: ACTOR_PASSWORD, code: '000000' },
    });
    expect(noCode.statusCode).toBe(400);

    const fresh = await request('/auth/two-factor/recovery-codes', {
      method: 'POST',
      actor: ada,
      payload: { password: ACTOR_PASSWORD, code: codeFor(secret, 1) },
    });
    expect(fresh.statusCode).toBe(200);
    expect((await signIn(ada, codes[0]!)).statusCode).toBe(401);
    expect((await signIn(ada, fresh.json().recoveryCodes[0])).statusCode).toBe(200);
  });

  test('turning it off needs the password and a code; then the password alone signs in', async () => {
    const ada = await createActor('Ada');
    const { codes } = await turnOn(ada);
    const wrongPassword = await request('/auth/two-factor/disable', {
      method: 'POST',
      actor: ada,
      payload: { password: 'not it', code: codes[0] },
    });
    expect(wrongPassword.statusCode).toBe(403);

    const off = await request('/auth/two-factor/disable', {
      method: 'POST',
      actor: ada,
      payload: { password: ACTOR_PASSWORD, code: codes[0] },
    });
    expect(off.statusCode).toBe(200);
    expect((await passwordStep(ada)).json().user.email).toBe(ada.email);
  });

  test('each is in the account’s own history', async () => {
    const ada = await createActor('Ada');
    const { codes } = await turnOn(ada);
    await signIn(ada, codes[0]!);
    const events = await request('/auth/me/events', { actor: ada });
    const types = events.json().events.map((e: { type: string }) => e.type);
    expect(types).toContain('auth.two_factor_enabled');
    expect(types).toContain('auth.recovery_code_used');
  });
});
