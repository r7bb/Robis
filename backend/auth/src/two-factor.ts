import {
  type Database,
  type Executor,
  recoveryCodes,
  signInChallenges,
  twoFactor,
} from '@robis/database';
import { and, count, eq, gt, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { hashRecoveryCode, newRecoveryCodes, normaliseRecoveryCode } from './recovery-codes.ts';
import { openSecret, sealSecret } from './secret-box.ts';
import { generateSessionToken, hashSessionToken } from './tokens.ts';
import { matchingStep, newTotpSecret } from './totp.ts';

/**
 * Two-factor sign-in (C4): an authenticator app's codes, recovery codes for
 * when the phone is gone, and the half-finished sign-in between the password
 * and the code. Every "works once" here is decided by a conditional write,
 * so two requests carrying the same code cannot both get in.
 */

/** A sealed secret that will not open: the server's key changed, or the row did. */
export class UnreadableSecret extends Error {
  constructor() {
    super('two-factor secret does not open with the configured key');
  }
}

export type TwoFactorState = {
  enabled: boolean;
  confirmedAt: Date | null;
  recoveryCodesLeft: number;
};

export async function twoFactorState(db: Executor, userId: string): Promise<TwoFactorState> {
  const [row] = await db
    .select({ confirmedAt: twoFactor.confirmedAt })
    .from(twoFactor)
    .where(eq(twoFactor.userId, userId))
    .limit(1);
  const [left] = await db
    .select({ n: count() })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
  const confirmedAt = row?.confirmedAt ?? null;
  return {
    enabled: confirmedAt !== null,
    confirmedAt,
    recoveryCodesLeft: confirmedAt ? (left?.n ?? 0) : 0,
  };
}

/** Whether signing in to this account asks for a second step. */
export async function hasTwoFactor(db: Executor, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: twoFactor.userId })
    .from(twoFactor)
    .where(and(eq(twoFactor.userId, userId), isNotNull(twoFactor.confirmedAt)))
    .limit(1);
  return Boolean(row);
}

/**
 * Begin setting up: a new secret, replacing any setup not finished. Null
 * when two-factor is already on, which must be turned off first, so a
 * signed-in session alone cannot quietly swap the authenticator.
 */
export async function startTwoFactorSetup(
  db: Executor,
  key: Buffer,
  userId: string,
): Promise<Buffer | null> {
  const secret = newTotpSecret();
  const secretSealed = sealSecret(key, secret, userId);
  const [row] = await db
    .insert(twoFactor)
    .values({ userId, secretSealed })
    .onConflictDoUpdate({
      target: twoFactor.userId,
      set: { secretSealed, lastStep: null, createdAt: sql`now()` },
      // Only a setup in progress is replaced.
      setWhere: isNull(twoFactor.confirmedAt),
    })
    .returning({ userId: twoFactor.userId });
  return row ? secret : null;
}

async function sealedSecretOf(
  db: Executor,
  userId: string,
  confirmed: boolean,
): Promise<string | null> {
  const [row] = await db
    .select({ sealed: twoFactor.secretSealed })
    .from(twoFactor)
    .where(
      and(
        eq(twoFactor.userId, userId),
        confirmed ? isNotNull(twoFactor.confirmedAt) : isNull(twoFactor.confirmedAt),
      ),
    )
    .limit(1);
  return row?.sealed ?? null;
}

function matchStep(key: Buffer, sealed: string, userId: string, code: string, now: Date) {
  const secret = openSecret(key, sealed, userId);
  if (!secret) throw new UnreadableSecret();
  return matchingStep(secret, code, now);
}

/** Replace every recovery code with a fresh set, shown once. */
export async function replaceRecoveryCodes(db: Executor, userId: string): Promise<string[]> {
  const codes = newRecoveryCodes();
  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  await db
    .insert(recoveryCodes)
    .values(
      codes.map((code) => ({ userId, codeHash: hashRecoveryCode(normaliseRecoveryCode(code)!) })),
    );
  return codes;
}

/**
 * Finish setting up with a code from the app, which proves it holds the
 * secret. Returns the recovery codes, to be shown once, or null for a wrong
 * code or no setup in progress.
 */
export async function confirmTwoFactor(
  db: Database,
  key: Buffer,
  userId: string,
  code: string,
  now: Date = new Date(),
): Promise<string[] | null> {
  const sealed = await sealedSecretOf(db, userId, false);
  if (!sealed) return null;
  const step = matchStep(key, sealed, userId, code, now);
  if (step === null) return null;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(twoFactor)
      .set({ confirmedAt: now, lastStep: step })
      // The secret checked is still the one stored, and still unconfirmed:
      // a second setup started meanwhile, or a second confirm, loses here.
      .where(
        and(
          eq(twoFactor.userId, userId),
          eq(twoFactor.secretSealed, sealed),
          isNull(twoFactor.confirmedAt),
        ),
      )
      .returning({ userId: twoFactor.userId });
    if (!row) return null;
    return replaceRecoveryCodes(tx, userId);
  });
}

/**
 * Spend an authenticator code: true once per time step, and only for a step
 * later than the last one taken, so a code seen over a shoulder or replayed
 * from a log is refused even inside its thirty seconds.
 */
export async function spendTotp(
  db: Executor,
  key: Buffer,
  userId: string,
  code: string,
  now: Date = new Date(),
): Promise<boolean> {
  const sealed = await sealedSecretOf(db, userId, true);
  if (!sealed) return false;
  const step = matchStep(key, sealed, userId, code, now);
  if (step === null) return false;

  const [row] = await db
    .update(twoFactor)
    .set({ lastStep: step })
    .where(
      and(
        eq(twoFactor.userId, userId),
        isNotNull(twoFactor.confirmedAt),
        or(isNull(twoFactor.lastStep), lt(twoFactor.lastStep, step)),
      ),
    )
    .returning({ userId: twoFactor.userId });
  return Boolean(row);
}

/** Spend a recovery code: true once per code. */
export async function spendRecoveryCode(
  db: Executor,
  userId: string,
  input: string,
): Promise<boolean> {
  const normal = normaliseRecoveryCode(input);
  if (!normal) return false;
  const [row] = await db
    .update(recoveryCodes)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(recoveryCodes.userId, userId),
        eq(recoveryCodes.codeHash, hashRecoveryCode(normal)),
        isNull(recoveryCodes.usedAt),
      ),
    )
    .returning({ id: recoveryCodes.id });
  return Boolean(row);
}

/**
 * Either kind of second step, read from its shape: six digits are an app
 * code, anything else is tried as a recovery code. Null when neither works.
 */
export async function spendSecondFactor(
  db: Executor,
  key: Buffer,
  userId: string,
  code: string,
  now: Date = new Date(),
): Promise<'totp' | 'recovery' | null> {
  if (/^\d{6}$/.test(code.replace(/\s/g, ''))) {
    return (await spendTotp(db, key, userId, code, now)) ? 'totp' : null;
  }
  return (await spendRecoveryCode(db, userId, code)) ? 'recovery' : null;
}

/** Turn two-factor off: the secret and every recovery code go. */
export async function disableTwoFactor(
  db: Database,
  userId: string,
  /**
   * Run after the delete, before the commit: a check that throws keeps it
   * on. The deleted row stays locked meanwhile, so the check sees anything
   * that was waiting on it.
   */
  beforeCommit?: (tx: Executor) => Promise<void>,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(twoFactor)
      .where(and(eq(twoFactor.userId, userId), isNotNull(twoFactor.confirmedAt)))
      .returning({ userId: twoFactor.userId });
    await beforeCommit?.(tx);
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    await tx.delete(signInChallenges).where(eq(signInChallenges.userId, userId));
    return removed.length > 0;
  });
}

/** Five minutes to find the phone and type the code. */
export const SIGN_IN_CHALLENGE_TTL_MS = 5 * 60_000;

/** Wrong codes one challenge takes before the password must be given again. */
export const SIGN_IN_CHALLENGE_ATTEMPTS = 5;

/** A sign-in owed its second step: a bearer secret, kept only as a hash. */
export async function createSignInChallenge(
  db: Executor,
  userId: string,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + SIGN_IN_CHALLENGE_TTL_MS);
  // One live at a time: a new sign-in replaces any half-done one, so the
  // password alone cannot stack up challenges to guess codes against.
  await revokeSignInChallenges(db, userId);
  await db
    .insert(signInChallenges)
    .values({ userId, tokenHash: hashSessionToken(token), expiresAt });
  return { token, expiresAt };
}

/** Drop every half-done sign-in for an account: its password just changed, say. */
export async function revokeSignInChallenges(db: Executor, userId: string): Promise<void> {
  await db.delete(signInChallenges).where(eq(signInChallenges.userId, userId));
}

function liveChallenge(token: string, now: Date) {
  return and(
    eq(signInChallenges.tokenHash, hashSessionToken(token)),
    gt(signInChallenges.expiresAt, now),
    lt(signInChallenges.attempts, SIGN_IN_CHALLENGE_ATTEMPTS),
  );
}

/**
 * Take one try from a live challenge before its code is checked, so tries
 * made at once cannot all slip past the limit. Returns whose sign-in it is
 * and which try this was, or null when it is not live (unknown, expired,
 * or out of tries).
 */
export async function reserveTry(
  db: Executor,
  token: string,
  now: Date = new Date(),
): Promise<{ userId: string; attempt: number } | null> {
  if (!token) return null;
  const [row] = await db
    .update(signInChallenges)
    .set({ attempts: sql`${signInChallenges.attempts} + 1` })
    .where(liveChallenge(token, now))
    .returning({ userId: signInChallenges.userId, attempt: signInChallenges.attempts });
  return row ?? null;
}

/** End a challenge whose tries are used up. */
export async function endChallenge(db: Executor, token: string): Promise<void> {
  await db.delete(signInChallenges).where(eq(signInChallenges.tokenHash, hashSessionToken(token)));
}

/**
 * Spend the challenge once its code was right: the delete is the check, so
 * of two requests finishing the same sign-in only one is given a session.
 */
export async function finishChallenge(
  db: Executor,
  token: string,
  now: Date = new Date(),
): Promise<string | null> {
  const [row] = await db
    .delete(signInChallenges)
    .where(
      and(
        eq(signInChallenges.tokenHash, hashSessionToken(token)),
        gt(signInChallenges.expiresAt, now),
      ),
    )
    .returning({ userId: signInChallenges.userId });
  return row?.userId ?? null;
}

/** Housekeeping, with expired sessions. */
export async function deleteExpiredChallenges(db: Executor): Promise<number> {
  const removed = await db
    .delete(signInChallenges)
    .where(lt(signInChallenges.expiresAt, new Date()))
    .returning({ id: signInChallenges.id });
  return removed.length;
}
