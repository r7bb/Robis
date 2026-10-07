import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  consumeAuthToken,
  deleteExpiredAuthTokens,
  EMAIL_VERIFICATION_TTL_MS,
  hashSessionToken,
  issueAuthToken,
  PASSWORD_RESET_TTL_MS,
} from '@relay/auth';
import { authTokens } from '@relay/database';
import { and, eq } from 'drizzle-orm';
import { closeHarness, createActor, getHarness, resetDatabase } from './harness.ts';

/**
 * One-time tokens for password reset and email verification.
 *
 * These are credentials, so the tests are mostly about what a token cannot do:
 * be used twice, be used after it expires, be used for a purpose it was not
 * issued for, or survive a newer token being issued.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const database = async () => (await getHarness()).db;

describe('issuing', () => {
  test('returns a token and its expiry', async () => {
    const db = await database();
    const actor = await createActor('Holder');

    const { token, expiresAt } = await issueAuthToken(db, actor.id, 'password_reset');

    expect(token.length).toBeGreaterThan(20);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  /** The token itself must not be recoverable from the database. */
  test('stores only the hash, never the token', async () => {
    const db = await database();
    const actor = await createActor('Holder');

    const { token } = await issueAuthToken(db, actor.id, 'password_reset');

    const [row] = await db
      .select({ tokenHash: authTokens.tokenHash })
      .from(authTokens)
      // Scoped by purpose: registering also issues a verification token, and
      // without this the row that comes back is whichever Postgres returns
      // first.
      .where(and(eq(authTokens.userId, actor.id), eq(authTokens.purpose, 'password_reset')));

    expect(row!.tokenHash).not.toBe(token);
    expect(row!.tokenHash).toBe(hashSessionToken(token));
  });

  test('two issues produce different tokens', async () => {
    const db = await database();
    const actor = await createActor('Holder');

    const first = await issueAuthToken(db, actor.id, 'password_reset');
    const second = await issueAuthToken(db, actor.id, 'password_reset');

    expect(first.token).not.toBe(second.token);
  });

  /**
   * Asking for a second reset link has to invalidate the first, or a leaked
   * older mail stays usable for as long as its own expiry allows.
   */
  test('issuing again invalidates the previous token for that purpose', async () => {
    const db = await database();
    const actor = await createActor('Holder');

    const first = await issueAuthToken(db, actor.id, 'password_reset');
    await issueAuthToken(db, actor.id, 'password_reset');

    expect(await consumeAuthToken(db, first.token, 'password_reset')).toBeNull();
  });

  test('a new token for one purpose leaves the other purpose alone', async () => {
    const db = await database();
    const actor = await createActor('Holder');

    const verification = await issueAuthToken(db, actor.id, 'email_verification');
    await issueAuthToken(db, actor.id, 'password_reset');

    // Resetting a password should not cancel a pending address confirmation.
    expect(await consumeAuthToken(db, verification.token, 'email_verification')).toBe(actor.id);
  });

  test('each purpose has its own lifetime', async () => {
    const db = await database();
    const actor = await createActor('Holder');

    const reset = await issueAuthToken(db, actor.id, 'password_reset');
    const verify = await issueAuthToken(db, actor.id, 'email_verification');

    const resetMinutes = Math.round((reset.expiresAt.getTime() - Date.now()) / 60_000);
    const verifyMinutes = Math.round((verify.expiresAt.getTime() - Date.now()) / 60_000);

    // A reset link is a standing risk, so it is short-lived; a welcome mail
    // may sit unread for a day.
    expect(resetMinutes).toBe(PASSWORD_RESET_TTL_MS / 60_000);
    expect(verifyMinutes).toBe(EMAIL_VERIFICATION_TTL_MS / 60_000);
    expect(resetMinutes).toBeLessThan(verifyMinutes);
  });
});

describe('consuming', () => {
  test('returns the owner and works exactly once', async () => {
    const db = await database();
    const actor = await createActor('Holder');

    const { token } = await issueAuthToken(db, actor.id, 'password_reset');

    expect(await consumeAuthToken(db, token, 'password_reset')).toBe(actor.id);
    // Replaying a reset link must not work.
    expect(await consumeAuthToken(db, token, 'password_reset')).toBeNull();
  });

  test('leaves no row behind', async () => {
    const db = await database();
    const actor = await createActor('Holder');

    const { token } = await issueAuthToken(db, actor.id, 'password_reset');
    await consumeAuthToken(db, token, 'password_reset');

    const rows = await db
      .select()
      .from(authTokens)
      .where(and(eq(authTokens.userId, actor.id), eq(authTokens.purpose, 'password_reset')));

    expect(rows).toEqual([]);
  });

  /**
   * The reason `purpose` is part of the lookup rather than only a label: a
   * verification link lands in an inbox and is the easiest token to obtain, so
   * it must not be spendable as a password reset.
   */
  test('a token cannot be used for a different purpose', async () => {
    const db = await database();
    const actor = await createActor('Holder');

    const { token } = await issueAuthToken(db, actor.id, 'email_verification');

    expect(await consumeAuthToken(db, token, 'password_reset')).toBeNull();
    // And the real purpose still works, so it was rejected rather than eaten.
    expect(await consumeAuthToken(db, token, 'email_verification')).toBe(actor.id);
  });

  test('an expired token is refused', async () => {
    const db = await database();
    const actor = await createActor('Holder');

    const past = new Date(Date.now() - PASSWORD_RESET_TTL_MS - 1000);
    const { token } = await issueAuthToken(db, actor.id, 'password_reset', past);

    expect(await consumeAuthToken(db, token, 'password_reset')).toBeNull();
  });

  test('nonsense is refused rather than throwing', async () => {
    const db = await database();

    for (const value of ['', 'not-a-token', 'x'.repeat(200)]) {
      expect(await consumeAuthToken(db, value, 'password_reset')).toBeNull();
    }
  });

  test('one account cannot spend another account token', async () => {
    const db = await database();
    const owner = await createActor('Owner');
    await createActor('Stranger');

    const { token } = await issueAuthToken(db, owner.id, 'password_reset');

    // Consuming names the owner, so a caller cannot redirect it.
    expect(await consumeAuthToken(db, token, 'password_reset')).toBe(owner.id);
  });
});

describe('sweeping expired tokens', () => {
  test('removes what has expired and keeps what has not', async () => {
    const db = await database();
    const actor = await createActor('Holder');

    const stale = await issueAuthToken(
      db,
      actor.id,
      'password_reset',
      new Date(Date.now() - PASSWORD_RESET_TTL_MS - 1000),
    );
    const live = await issueAuthToken(db, actor.id, 'email_verification');

    await deleteExpiredAuthTokens(db);

    const rows = await db
      .select({ hash: authTokens.tokenHash })
      .from(authTokens)
      .where(eq(authTokens.userId, actor.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.hash).toBe(hashSessionToken(live.token));
    expect(await consumeAuthToken(db, stale.token, 'password_reset')).toBeNull();
  });
});
