import { issuePersonalToken } from '@robis/auth';
import { type Database, personalAccessTokens, recordAccountEvent } from '@robis/database';
import { contracts, TOKENS_MAX } from '@robis/shared';
import { and, count, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { confirmPassword } from '../confirm-password.ts';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import { currentUser, requireAuth } from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';

/**
 * Personal access tokens (C7), managed by their owner while signed in.
 * These are account routes, which a token never reaches (it is honoured
 * on workspace routes only), so a leaked token cannot make another or keep
 * itself alive. Making one asks for the password again, so a session left
 * open cannot quietly make a lasting key; a password change or a sign-out
 * everywhere revokes them all. Making and revoking each go in the account's
 * own trail.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const wire = (row: typeof personalAccessTokens.$inferSelect) => ({
  id: row.id,
  name: row.name,
  scopes: row.scopes as ('read' | 'write')[],
  createdAt: row.createdAt,
  lastUsedAt: row.lastUsedAt,
  expiresAt: row.expiresAt,
});

const live = (userId: string) =>
  and(
    eq(personalAccessTokens.userId, userId),
    isNull(personalAccessTokens.revokedAt),
    or(isNull(personalAccessTokens.expiresAt), gt(personalAccessTokens.expiresAt, new Date())),
  );

export async function personalTokenRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  serve(app, contracts['tokens.list'], { preHandler: requireAuth }, async (request) => {
    const user = currentUser(request);
    const rows = await db
      .select()
      .from(personalAccessTokens)
      .where(live(user.id))
      .orderBy(desc(personalAccessTokens.createdAt));
    return { tokens: rows.map(wire) };
  });

  serve(
    app,
    contracts['tokens.create'],
    {
      preHandler: [requireAuth, rateLimit({ name: 'token-create', limit: 10, windowMs: 60_000 })],
    },
    async (request, { body }) => {
      const user = currentUser(request);
      await confirmPassword(db, user.id, body.password);
      const made = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tokens:${user.id}`}))`);
        const [{ n } = { n: 0 }] = await tx
          .select({ n: count() })
          .from(personalAccessTokens)
          .where(live(user.id));
        if (n >= TOKENS_MAX) {
          throw ApiError.conflict(
            `You can hold at most ${TOKENS_MAX} tokens; revoke one first.`,
            'tokens_max',
          );
        }
        const issued = await issuePersonalToken(tx, {
          userId: user.id,
          name: body.name,
          scopes: body.write ? ['read', 'write'] : ['read'],
          expiresAt: body.lifetimeDays ? new Date(Date.now() + body.lifetimeDays * DAY_MS) : null,
        });
        await recordAccountEvent(tx, user.id, 'auth.token_created', {
          requestId: request.id,
          payload: { name: body.name, write: body.write, lifetimeDays: body.lifetimeDays },
        });
        return issued;
      });
      return { token: wire(made.token), secret: made.secret };
    },
  );

  serve(
    app,
    contracts['tokens.revoke'],
    { preHandler: requireAuth },
    async (request, { params }, reply) => {
      const user = currentUser(request);
      await db.transaction(async (tx) => {
        const [row] = await tx
          .update(personalAccessTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(personalAccessTokens.id, params.tokenId), live(user.id)))
          .returning({ name: personalAccessTokens.name });
        if (!row) throw ApiError.notFound('No such token');
        await recordAccountEvent(tx, user.id, 'auth.token_revoked', {
          requestId: request.id,
          payload: { name: row.name },
        });
      });
      return reply.code(204).send();
    },
  );
}
