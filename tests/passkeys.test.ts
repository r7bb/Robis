import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { base32Decode, MAX_PASSKEYS, totpAt, totpStep } from '@robis/auth';
import { passkeyChallenges } from '@robis/database';
import { eq } from 'drizzle-orm';
import {
  ACTOR_PASSWORD,
  type Actor,
  closeHarness,
  createActor,
  getHarness,
  getMailer,
  knownBrowser,
  request,
  resetDatabase,
} from './harness.ts';
import { type SoftKey, softPasskey } from './passkey-authenticator.ts';

/**
 * Passkeys (C4). Done when: one can be added with the password, signs in
 * once per challenge, is refused without the user verified, from another
 * origin, with its count gone backwards or once removed, and nobody can
 * use or remove another's.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

type Options = { challengeId: string; options: { challenge: string; user?: { id: string } } };

async function startAdding(actor: Actor, password = ACTOR_PASSWORD, code?: string) {
  return request('/auth/passkeys/options', {
    method: 'POST',
    actor,
    payload: { password, ...(code ? { code } : {}) },
  });
}

/** Two-factor on, with the app's secret, for codes to come. */
async function withTwoFactor(actor: Actor) {
  const setup = await request('/auth/two-factor/setup', {
    method: 'POST',
    actor,
    payload: { password: ACTOR_PASSWORD },
  });
  const secret = base32Decode(setup.json().secret)!;
  await request('/auth/two-factor/enable', {
    method: 'POST',
    actor,
    payload: { code: totpAt(secret, totpStep()) },
  });
  // The next step's code: the one just used works only once.
  return () => totpAt(secret, totpStep() + 1);
}

async function addPasskey(
  actor: Actor,
  key: SoftKey = softPasskey(),
  name = 'My laptop',
  code?: string,
) {
  const started = await startAdding(actor, ACTOR_PASSWORD, code);
  expect(started.statusCode).toBe(200);
  const { challengeId, options } = started.json() as Options;
  key.userHandle = options.user!.id;
  const added = await request('/auth/passkeys', {
    method: 'POST',
    actor,
    payload: { challengeId, name, response: key.register(options.challenge) },
  });
  return { key, added };
}

async function signInWith(
  key: SoftKey,
  answer: (challenge: string) => unknown = (c) => key.signIn(c),
) {
  const started = await request('/auth/passkey/options', { method: 'POST' });
  expect(started.statusCode).toBe(200);
  const { challengeId, options } = started.json() as Options;
  return {
    challengeId,
    response: await request('/auth/passkey', {
      method: 'POST',
      payload: { challengeId, response: answer(options.challenge) },
    }),
  };
}

const sessionOf = (response: { headers: Record<string, unknown> }) => {
  const raw = response.headers['set-cookie'];
  return String((Array.isArray(raw) ? raw : [raw])[0]).split(';')[0]!;
};

describe('adding a passkey', () => {
  test('needs the password, then the authenticator, and is listed without its key', async () => {
    const actor = await createActor('Sam');
    expect((await startAdding(actor, 'not-the-password')).statusCode).toBe(403);

    const { added } = await addPasskey(actor);
    expect(added.statusCode).toBe(200);
    expect(added.json().passkey.name).toBe('My laptop');

    const listed = (await request('/auth/passkeys', { actor })).json().passkeys;
    expect(listed).toHaveLength(1);
    expect(Object.keys(listed[0]).sort()).toEqual(['createdAt', 'id', 'lastUsedAt', 'name']);
    const events = (await request('/auth/me/events', { actor })).json().events;
    expect(events.map((e: { type: string }) => e.type)).toContain('auth.passkey_added');
  });

  test('is refused without the user verified, or from another origin', async () => {
    const actor = await createActor('Sam');
    for (const answer of [
      (key: SoftKey, c: string) => key.register(c, { verified: false }),
      (key: SoftKey, c: string) => key.register(c, { origin: 'https://evil.example' }),
    ]) {
      const { challengeId, options } = (await startAdding(actor)).json() as Options;
      const refused = await request('/auth/passkeys', {
        method: 'POST',
        actor,
        payload: { challengeId, name: 'Nope', response: answer(softPasskey(), options.challenge) },
      });
      expect(refused.statusCode).toBe(400);
    }
    expect((await request('/auth/passkeys', { actor })).json().passkeys).toEqual([]);
  });

  test('with two-factor on, needs a right code as well as the password', async () => {
    const actor = await createActor('Sam');
    const nextCode = await withTwoFactor(actor);
    const missing = await startAdding(actor);
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toBe('code_required');
    const wrong = await startAdding(actor, ACTOR_PASSWORD, '000000');
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error).toBe('bad_code');
    expect((await startAdding(actor, ACTOR_PASSWORD, nextCode())).statusCode).toBe(200);
  });

  test("cannot finish on another account's challenge", async () => {
    const sam = await createActor('Sam');
    const kim = await createActor('Kim');
    const { challengeId, options } = (await startAdding(sam)).json() as Options;
    const refused = await request('/auth/passkeys', {
      method: 'POST',
      actor: kim,
      payload: { challengeId, name: 'Taken', response: softPasskey().register(options.challenge) },
    });
    expect(refused.statusCode).toBe(400);
  });

  test(`stops at ${MAX_PASSKEYS} for one account`, async () => {
    const actor = await createActor('Sam');
    for (let i = 0; i < MAX_PASSKEYS; i++) {
      expect((await addPasskey(actor, softPasskey(), `Key ${i}`)).added.statusCode).toBe(200);
    }
    const refused = await startAdding(actor);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe('too_many_passkeys');
  });
});

describe('signing in with a passkey', () => {
  test('lets its owner in, with a session, and says so in the history', async () => {
    const actor = await createActor('Sam');
    const { key } = await addPasskey(actor);

    const { response } = await signInWith(key);
    expect(response.statusCode).toBe(200);
    expect(response.json().user.id).toBe(actor.id);
    const me = await request('/auth/me', {
      headers: { cookie: `${sessionOf(response)}; ${knownBrowser(actor.email)}` },
    });
    expect(me.json().user.id).toBe(actor.id);
    const events = (await request('/auth/me/events', { actor })).json().events;
    const signedIn = events.find(
      (e: { type: string; payload: { with?: string } }) =>
        e.type === 'auth.signed_in' && e.payload.with === 'passkey',
    );
    expect(signedIn).toBeTruthy();
  });

  test('goes straight in with two-factor on: the passkey is both factors', async () => {
    const actor = await createActor('Sam');
    const nextCode = await withTwoFactor(actor);
    const { key, added } = await addPasskey(actor, softPasskey(), 'Phone', nextCode());
    expect(added.statusCode).toBe(200);
    const { response } = await signInWith(key);
    expect(response.statusCode).toBe(200);
    expect(response.json().user.id).toBe(actor.id);
  });

  test('answers each challenge once', async () => {
    const actor = await createActor('Sam');
    const { key } = await addPasskey(actor);
    const started = (await request('/auth/passkey/options', { method: 'POST' })).json() as Options;
    const answer = key.signIn(started.options.challenge);
    const once = await request('/auth/passkey', {
      method: 'POST',
      payload: { challengeId: started.challengeId, response: answer },
    });
    expect(once.statusCode).toBe(200);
    const twice = await request('/auth/passkey', {
      method: 'POST',
      payload: { challengeId: started.challengeId, response: answer },
    });
    expect(twice.statusCode).toBe(401);
  });

  test('is refused without the user verified, from another origin, or with its count gone back', async () => {
    const actor = await createActor('Sam');
    const { key } = await addPasskey(actor);
    expect((await signInWith(key)).response.statusCode).toBe(200);
    expect((await signInWith(key, (c) => key.signIn(c, { counter: 5 }))).response.statusCode).toBe(
      200,
    );

    for (const answer of [
      (c: string) => key.signIn(c, { verified: false }),
      (c: string) => key.signIn(c, { origin: 'https://evil.example' }),
      (c: string) => key.signIn(c, { counter: 2 }),
    ]) {
      const { response } = await signInWith(key, answer);
      expect(response.statusCode).toBe(401);
      expect(response.json().message).toMatch(/could not be used here/);
    }
  });

  test('is refused when the authenticator does not say whose it is', async () => {
    const actor = await createActor('Sam');
    const { key } = await addPasskey(actor);
    key.userHandle = null;
    expect((await signInWith(key)).response.statusCode).toBe(401);
  });

  test('is refused once its challenge has run out', async () => {
    const actor = await createActor('Sam');
    const { key } = await addPasskey(actor);
    const started = (await request('/auth/passkey/options', { method: 'POST' })).json() as Options;
    const { ownerDb } = await getHarness();
    await ownerDb
      .update(passkeyChallenges)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(passkeyChallenges.id, started.challengeId));
    const late = await request('/auth/passkey', {
      method: 'POST',
      payload: {
        challengeId: started.challengeId,
        response: key.signIn(started.options.challenge),
      },
    });
    expect(late.statusCode).toBe(401);
  });

  test('is refused for a passkey this server does not know', async () => {
    const { response } = await signInWith(softPasskey());
    expect(response.statusCode).toBe(401);
  });

  test('is refused when the authenticator names another account', async () => {
    const sam = await createActor('Sam');
    const kim = await createActor('Kim');
    const { key } = await addPasskey(sam);
    const { key: kims } = await addPasskey(kim);
    key.userHandle = kims.userHandle;
    expect((await signInWith(key)).response.statusCode).toBe(401);
  });
});

describe('removing a passkey', () => {
  test('stops it signing in; another account cannot remove it', async () => {
    const sam = await createActor('Sam');
    const kim = await createActor('Kim');
    const { key, added } = await addPasskey(sam);
    const id = added.json().passkey.id as string;

    const notTheirs = await request(`/auth/passkeys/${id}`, { method: 'DELETE', actor: kim });
    expect(notTheirs.statusCode).toBe(404);
    expect((await signInWith(key)).response.statusCode).toBe(200);

    const removed = await request(`/auth/passkeys/${id}`, { method: 'DELETE', actor: sam });
    expect(removed.statusCode).toBe(200);
    expect((await signInWith(key)).response.statusCode).toBe(401);
  });

  test('every passkey goes with "this was not me", as one may be the stranger’s', async () => {
    const actor = await createActor('Sam');
    const { key } = await addPasskey(actor);
    (await getMailer()).clear();
    await request('/auth/login', {
      method: 'POST',
      payload: { email: actor.email, password: ACTOR_PASSWORD },
    });
    const alert = (await getMailer()).lastTo(actor.email)!;
    const token = /\/not-me\?token=([A-Za-z0-9_-]+)/.exec(alert.text)![1];
    expect((await request('/auth/not-me', { method: 'POST', payload: { token } })).statusCode).toBe(
      200,
    );
    expect((await signInWith(key)).response.statusCode).toBe(401);
  });
});
