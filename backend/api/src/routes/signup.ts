import {
  type Database,
  queueSignupExistingMail,
  queueSignupMail,
  signups,
  users,
} from '@robis/database';
import { signupStartSchema } from '@robis/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { RateLimits } from '../app.ts';
import { rateLimit } from '../plugins/rate-limit.ts';
import { parse } from '../validate.ts';
import { FORGOT_FLOOR_MS } from './auth-recovery.ts';

/**
 * Starting a sign-up (email-first; stage 1, item 12).
 *
 * The form asks only for an address and always answers 202 "check your
 * inbox", after the same minimum time, whether or not the address has an
 * account. A new address is mailed a link that finishes signing up (see
 * `/auth/register`); an address that already has an account is mailed a
 * reminder to sign in instead. Only the owner of the inbox learns which it
 * was, so the form cannot be used to find out who is on Robis. Invitations
 * by email answer the same way, for the same reason.
 *
 * Limited per caller and per address, like a reset request: the address is
 * chosen by the caller, so a per-caller limit alone would let anyone flood
 * one inbox.
 */
export async function signupRoutes(
  app: FastifyInstance,
  opts: { db: Database; limits: RateLimits; floorMs?: number },
) {
  const { db, limits, floorMs = FORGOT_FLOOR_MS } = opts;

  const perCaller = rateLimit({ name: 'signup', limit: limits.authPerMinute, windowMs: 60_000 });
  const perAddress = rateLimit({
    name: 'signup-address',
    limit: limits.passwordForgotPerHourPerAddress,
    windowMs: 60 * 60_000,
    key: (request) => {
      const parsed = signupStartSchema.safeParse(request.body);
      return parsed.success ? `email:${parsed.data.email}` : null;
    },
  });

  app.post('/auth/signup', { preHandler: [perCaller, perAddress] }, async (request, reply) => {
    const startedAt = Date.now();
    // An address that is not one is the caller's own typo, not an oracle.
    const { email } = parse(signupStartSchema, request.body);

    try {
      const [account] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (account) {
        await queueSignupExistingMail(db, account.id);
      } else {
        await db.transaction(async (tx) => {
          // A row per request: asking again sends another link and leaves
          // the one already sent working.
          const [signup] = await tx.insert(signups).values({ email }).returning({ id: signups.id });
          await queueSignupMail(tx, signup!.id);
        });
      }
    } catch (error) {
      // Logged, never surfaced: the reply is fixed by design, and a 500 here
      // would itself reveal which branch ran.
      request.log.error({ err: error }, 'failed to queue sign-up mail');
    }

    const remaining = floorMs - (Date.now() - startedAt);
    if (remaining > 0) await Bun.sleep(remaining);
    // Past the floor, the two branches could take visibly different times.
    else if (floorMs > 0)
      request.log.warn({ overMs: -remaining }, 'sign-up reply passed its floor');
    return reply.status(202).send({ status: 'check_inbox' });
  });
}
