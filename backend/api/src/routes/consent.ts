import { type Database, recordAccountEvent, users } from '@robis/database';
import { consentSchema, TERMS_VERSION } from '@robis/shared';
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors.ts';
import { currentUser, requireAuth } from '../plugins/authz.ts';
import { withIdempotency } from '../plugins/idempotency.ts';
import { rateLimit } from '../plugins/rate-limit.ts';
import { parse } from '../validate.ts';

/**
 * The two questions an account is asked before anything else, and asked
 * again only when the answer no longer holds.
 *
 * Agreeing to the terms: stored with the minimum-age confirmation, the
 * version agreed to and the time (DRAFT FOR LEGAL REVIEW, as the terms
 * are). Keeping a username: for accounts whose name was given to them by
 * a migration rather than chosen. Both are account events in the person's
 * own history, written in the same transaction as the change.
 */
export async function consentRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  const answerLimit = rateLimit({ name: 'consent', limit: 30, windowMs: 60_000 });

  app.post(
    '/auth/me/consent',
    { preHandler: [requireAuth, answerLimit] },
    async (request, reply) => {
      const user = currentUser(request);
      const input = parse(consentSchema, request.body);

      // Agreeing to a version the page no longer shows is not agreeing.
      if (input.termsVersion !== TERMS_VERSION) {
        throw ApiError.conflict(
          'The terms changed while this page was open; reload to see them',
          'terms_changed',
        );
      }

      return withIdempotency(db, request, reply, 200, async () => {
        await db.transaction(async (tx) => {
          // Only when it is still needed: agreeing again to the same version
          // must not overwrite when, or add another record of it.
          const agreed = await tx
            .update(users)
            .set({
              ageConfirmedAt: sql`now()`,
              termsVersion: TERMS_VERSION,
              termsAcceptedAt: sql`now()`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(users.id, user.id),
                or(isNull(users.termsVersion), ne(users.termsVersion, TERMS_VERSION)),
              ),
            )
            .returning({ id: users.id });
          if (agreed.length > 0) {
            await recordAccountEvent(tx, user.id, 'auth.terms_accepted', {
              payload: { termsVersion: TERMS_VERSION },
              requestId: request.id,
            });
          }
        });
        return { consent: { needed: false, termsVersion: TERMS_VERSION, current: TERMS_VERSION } };
      });
    },
  );

  /** Keep the username you were given; changing it confirms it too. */
  app.post(
    '/auth/me/username/confirm',
    { preHandler: [requireAuth, answerLimit] },
    async (request, reply) => {
      const user = currentUser(request);

      return withIdempotency(db, request, reply, 200, async () => {
        await db.transaction(async (tx) => {
          const confirmed = await tx
            .update(users)
            .set({ usernameConfirmedAt: sql`now()`, updatedAt: new Date() })
            // Once: keeping it again is not news.
            .where(and(eq(users.id, user.id), isNull(users.usernameConfirmedAt)))
            .returning({ id: users.id });
          if (confirmed.length > 0) {
            await recordAccountEvent(tx, user.id, 'auth.username_confirmed', {
              requestId: request.id,
            });
          }
        });
        return { usernameConfirmed: true };
      });
    },
  );
}
