import { type Executor, passkeyChallenges, passkeys } from '@robis/database';
import { and, asc, count, eq, gt, isNull, lt, sql } from 'drizzle-orm';

/**
 * Passkeys (C4), as stored. The WebAuthn checks themselves are the API's,
 * with @simplewebauthn/server; this is only what is kept between steps.
 */

/** Long enough to find the phone and touch the sensor. */
export const PASSKEY_CHALLENGE_TTL_MS = 5 * 60_000;
/** Passkeys one account may hold: plenty for every device, not a store. */
export const MAX_PASSKEYS = 10;

export type PasskeyPurpose = 'register' | 'sign_in';

/** A challenge waiting for its answer, for one person (register) or anyone (sign-in). */
export async function savePasskeyChallenge(
  db: Executor,
  purpose: PasskeyPurpose,
  challenge: string,
  userId: string | null,
  now: Date = new Date(),
): Promise<string> {
  const [row] = await db
    .insert(passkeyChallenges)
    .values({
      purpose,
      challenge,
      userId,
      expiresAt: new Date(now.getTime() + PASSKEY_CHALLENGE_TTL_MS),
    })
    .returning({ id: passkeyChallenges.id });
  return row!.id;
}

/**
 * Spend a challenge, returning it, or null. The delete is the check, as for
 * one-time links: two answers to one challenge cannot both be heard.
 */
export async function takePasskeyChallenge(
  db: Executor,
  id: string,
  purpose: PasskeyPurpose,
  userId: string | null,
  now: Date = new Date(),
): Promise<string | null> {
  const [row] = await db
    .delete(passkeyChallenges)
    .where(
      and(
        eq(passkeyChallenges.id, id),
        eq(passkeyChallenges.purpose, purpose),
        userId === null ? isNull(passkeyChallenges.userId) : eq(passkeyChallenges.userId, userId),
        gt(passkeyChallenges.expiresAt, now),
      ),
    )
    .returning({ challenge: passkeyChallenges.challenge });
  return row?.challenge ?? null;
}

export type StoredPasskey = {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[] | undefined;
};

function transportsOf(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((t): t is string => typeof t === 'string')
      : undefined;
  } catch {
    return undefined;
  }
}

export async function findPasskey(
  db: Executor,
  credentialId: string,
): Promise<StoredPasskey | null> {
  const [row] = await db
    .select({
      id: passkeys.id,
      userId: passkeys.userId,
      credentialId: passkeys.credentialId,
      publicKey: passkeys.publicKey,
      counter: passkeys.counter,
      transports: passkeys.transports,
    })
    .from(passkeys)
    .where(eq(passkeys.credentialId, credentialId))
    .limit(1);
  return row ? { ...row, transports: transportsOf(row.transports) } : null;
}

/** An account's passkeys, oldest first, without their keys. */
export async function listPasskeys(db: Executor, userId: string) {
  return db
    .select({
      id: passkeys.id,
      name: passkeys.name,
      createdAt: passkeys.createdAt,
      lastUsedAt: passkeys.lastUsedAt,
    })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .orderBy(asc(passkeys.createdAt), asc(passkeys.id));
}

/** The credential ids an account already has, so a device is not added twice. */
export async function credentialIdsOf(db: Executor, userId: string) {
  return db
    .select({ id: passkeys.credentialId, transports: passkeys.transports })
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .then((rows) => rows.map((row) => ({ id: row.id, transports: transportsOf(row.transports) })));
}

export async function passkeyCount(db: Executor, userId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(passkeys).where(eq(passkeys.userId, userId));
  return row?.n ?? 0;
}

export async function savePasskey(
  db: Executor,
  passkey: {
    userId: string;
    credentialId: string;
    publicKey: string;
    counter: number;
    transports: string[] | undefined;
    name: string;
  },
): Promise<{ id: string } | null> {
  const [row] = await db
    .insert(passkeys)
    .values({
      ...passkey,
      transports: passkey.transports ? JSON.stringify(passkey.transports) : null,
    })
    // A credential id is the device's: one already here is not added again.
    .onConflictDoNothing({ target: passkeys.credentialId })
    .returning({ id: passkeys.id });
  return row ?? null;
}

/** After a sign-in: the authenticator's new count, and when. */
export async function markPasskeyUsed(
  db: Executor,
  id: string,
  counter: number,
  now: Date = new Date(),
): Promise<void> {
  // Never lowered: of two sign-ins at once, the higher count stays.
  await db
    .update(passkeys)
    .set({ counter: sql`greatest(${passkeys.counter}, ${counter})`, lastUsedAt: now })
    .where(eq(passkeys.id, id));
}

/** Remove one of an account's passkeys; false when it is not theirs, or gone. */
export async function removePasskey(db: Executor, userId: string, id: string): Promise<boolean> {
  const removed = await db
    .delete(passkeys)
    .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
    .returning({ id: passkeys.id });
  return removed.length > 0;
}

/** Every passkey an account has: after "this was not me", one may be the stranger's. */
export async function removeAllPasskeys(db: Executor, userId: string): Promise<void> {
  await db.delete(passkeys).where(eq(passkeys.userId, userId));
}

/** Sign-in challenges waiting now, from anyone: bounded, as asking needs no account. */
export async function waitingSignInChallenges(db: Executor, now: Date = new Date()) {
  const [row] = await db
    .select({ n: count() })
    .from(passkeyChallenges)
    .where(and(eq(passkeyChallenges.purpose, 'sign_in'), gt(passkeyChallenges.expiresAt, now)));
  return row?.n ?? 0;
}

/** Housekeeping: challenges nobody answered. */
export async function deleteExpiredPasskeyChallenges(
  db: Executor,
  now: Date = new Date(),
): Promise<number> {
  const removed = await db
    .delete(passkeyChallenges)
    .where(lt(passkeyChallenges.expiresAt, now))
    .returning({ id: passkeyChallenges.id });
  return removed.length;
}
