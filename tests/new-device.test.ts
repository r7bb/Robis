import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { DEVICE_COOKIE, DEVICE_TTL_MS, deleteStaleDevices } from '@robis/auth';
import { knownDevices } from '@robis/database';
import { describeBrowser } from '@robis/mailer';
import { eq } from 'drizzle-orm';
import {
  ACTOR_PASSWORD,
  type Actor,
  closeHarness,
  createActor,
  getHarness,
  getMailer,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * A sign-in from a new browser mails its owner (C4), with a link that
 * signs out everywhere. Done when: the browser you signed up in, or have
 * used since, sends nothing; another one sends one mail; and its link ends
 * every session, once.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

type Cookies = { session: string; device: string | null };

function cookiesOf(response: { headers: Record<string, unknown> }): Cookies {
  const raw = response.headers['set-cookie'];
  const all = (Array.isArray(raw) ? raw : [raw]).filter(Boolean) as string[];
  const value = (name: string) =>
    all
      .find((c) => c.startsWith(`${name}=`))
      ?.split(';')[0]
      ?.slice(name.length + 1) ?? null;
  return { session: all[0]!.split(';')[0]!, device: value(DEVICE_COOKIE) };
}

async function signIn(actor: Actor, device?: string | null) {
  const response = await request('/auth/login', {
    method: 'POST',
    payload: { email: actor.email, password: ACTOR_PASSWORD },
    headers: {
      'user-agent': CHROME_MAC,
      ...(device ? { cookie: `${DEVICE_COOKIE}=${device}` } : {}),
    },
  });
  expect(response.statusCode).toBe(200);
  return cookiesOf(response);
}

async function alertsTo(actor: Actor) {
  const mailer = await getMailer();
  return mailer.sent.filter(
    (m) => m.to === actor.email && m.subject === 'New sign-in to your Robis account',
  );
}

const notMeTokenIn = (text: string) => /\/not-me\?token=([A-Za-z0-9_-]+)/.exec(text)?.[1];

describe('a sign-in from a browser', () => {
  test('already used sends nothing, and the device cookie is kept apart and httpOnly', async () => {
    const actor = await createActor('Sam');
    const first = await signIn(actor);
    (await getMailer()).clear();
    const again = await signIn(actor, first.device);
    expect(again.device).toBe(first.device);
    expect(await alertsTo(actor)).toEqual([]);

    const login = await request('/auth/login', {
      method: 'POST',
      payload: { email: actor.email, password: ACTOR_PASSWORD },
    });
    const raw = login.headers['set-cookie'];
    const deviceCookie = (Array.isArray(raw) ? raw : [raw]).find((c) =>
      String(c).startsWith(`${DEVICE_COOKIE}=`),
    );
    expect(String(deviceCookie)).toMatch(/HttpOnly/i);
    expect(String(deviceCookie)).toMatch(/SameSite=Lax/i);
  });

  test('new to the account mails its owner once, naming the browser, with a link', async () => {
    const actor = await createActor('Sam');
    (await getMailer()).clear();
    await signIn(actor);

    const [alert, ...more] = await alertsTo(actor);
    expect(more).toEqual([]);
    expect(alert?.text).toContain('Chrome on macOS');
    expect(alert?.text).toContain('UTC');
    expect(alert?.text).toContain('The link works once, for 7 days.');
    expect(notMeTokenIn(alert!.text)).toBeTruthy();

    const trail = await request('/auth/me/events', { actor });
    expect(trail.statusCode).toBe(200);
    const types = trail.json().events.map((e: { type: string }) => e.type);
    expect(types).toContain('auth.new_device');
  });

  test('a made-up device cookie counts as new, and is replaced rather than trusted', async () => {
    const actor = await createActor('Sam');
    (await getMailer()).clear();
    const planted = 'x'.repeat(43);
    const signedIn = await signIn(actor, planted);
    expect(await alertsTo(actor)).toHaveLength(1);
    expect(signedIn.device).not.toBe(planted);
    // Planted again, it is still a stranger.
    await signIn(actor, planted);
    expect(await alertsTo(actor)).toHaveLength(2);
  });

  test('mails at most three alerts an hour, however often a stranger signs in', async () => {
    const actor = await createActor('Sam');
    (await getMailer()).clear();
    for (let i = 0; i < 5; i++) await signIn(actor);
    expect(await alertsTo(actor)).toHaveLength(3);
  });

  test('browsers not seen for longer than their cookie lives are removed', async () => {
    const actor = await createActor('Sam');
    const { db } = await getHarness();
    const later = new Date(Date.now() + DEVICE_TTL_MS + 60_000);
    expect(await deleteStaleDevices(db, later)).toBeGreaterThanOrEqual(1);
    const left = await db.select().from(knownDevices).where(eq(knownDevices.userId, actor.id));
    expect(left).toEqual([]);
  });
});

describe('this was not me', () => {
  test('ends every session, once, and makes every browser new again', async () => {
    const actor = await createActor('Sam');
    const intruder = await signIn(actor);
    const [alert] = await alertsTo(actor);
    const token = notMeTokenIn(alert!.text)!;

    const ended = await request('/auth/not-me', { method: 'POST', payload: { token } });
    expect(ended.statusCode).toBe(200);

    for (const cookie of [actor.cookie, intruder.session]) {
      const me = await request('/auth/me', { headers: { cookie } });
      expect(me.statusCode).toBe(401);
    }

    const again = await request('/auth/not-me', { method: 'POST', payload: { token } });
    expect(again.statusCode).toBe(400);
    expect(again.json().error).toBe('invalid_token');

    // Every browser is a stranger now, the one that was known too: the very
    // next sign-in mails again, whoever makes it.
    (await getMailer()).clear();
    await signIn(actor, intruder.device);
    expect(await alertsTo(actor)).toHaveLength(1);
  });

  test('an unknown link is refused the same as a spent one', async () => {
    const response = await request('/auth/not-me', {
      method: 'POST',
      payload: { token: 'not-a-real-token-at-all' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid_token');
  });
});

describe('describing the browser', () => {
  test('reads the common ones, and says so when it cannot', () => {
    expect(describeBrowser(CHROME_MAC)).toBe('Chrome on macOS');
    expect(
      describeBrowser(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
      ),
    ).toBe('Firefox on Windows');
    expect(
      describeBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari on iOS');
    expect(describeBrowser(null)).toBe('An unknown browser');
    expect(describeBrowser('curl/8.7.1')).toBe('An unknown browser');
  });
});
