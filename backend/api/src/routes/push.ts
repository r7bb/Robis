import { type Database, pushSubscriptions } from '@robis/database';
import { contracts, isAllowedPushEndpoint, PUSH_DEVICES_PER_USER } from '@robis/shared';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { RateLimits } from '../app.ts';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import { currentUser, requireAuth } from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';

/**
 * The public key from the environment, checked now: a key that is not a
 * P-256 point would let browsers subscribe to nothing that works.
 */
export function pushKey(raw: string): string | null {
  const key = raw.trim();
  if (!key) return null;
  const point = Buffer.from(key, 'base64url');
  if (point.length !== 65 || point[0] !== 4) {
    throw new Error(
      'VAPID_PUBLIC_KEY is not a P-256 public key (make a pair with bun run push:keys).',
    );
  }
  return key;
}

/**
 * Web push (C3): which devices take pushes for whom. An endpoint comes from
 * the browser, so only the browsers' own push services are taken (see
 * `isAllowedPushEndpoint`): the worker will POST to whatever is stored.
 */
export async function pushRoutes(
  app: FastifyInstance,
  opts: { db: Database; limits: RateLimits; publicKey: string | null },
) {
  const { db, limits, publicKey } = opts;
  // Turning a device on or off is rare; a burst of it is not a person.
  const limited = rateLimit({
    name: 'push-devices',
    limit: limits.pushDevicesPerMinute,
    windowMs: 60_000,
  });

  serve(app, contracts['push.key'], {}, async () => ({ publicKey }));

  serve(
    app,
    contracts['pushSubscriptions.add'],
    { preHandler: [requireAuth, limited] },
    async (request, { body: { endpoint } }) => {
      if (!publicKey) throw ApiError.conflict('Web push is not set up on this server', 'push_off');
      if (!isAllowedPushEndpoint(endpoint)) {
        throw ApiError.badRequest(
          'That is not a push service this server sends to',
          'bad_endpoint',
        );
      }
      const user = currentUser(request);
      await db.transaction(async (tx) => {
        // One browser, one row: signing in as someone else there moves it,
        // and it counts as their newest.
        await tx
          .insert(pushSubscriptions)
          .values({ userId: user.id, endpoint })
          .onConflictDoUpdate({
            target: pushSubscriptions.endpoint,
            set: { userId: user.id, createdAt: new Date() },
          });
        const kept = tx
          .select({ id: pushSubscriptions.id })
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.userId, user.id))
          .orderBy(desc(pushSubscriptions.createdAt))
          .limit(PUSH_DEVICES_PER_USER);
        await tx
          .delete(pushSubscriptions)
          .where(
            and(eq(pushSubscriptions.userId, user.id), notInArray(pushSubscriptions.id, kept)),
          );
      });
      return undefined;
    },
  );

  serve(
    app,
    contracts['pushSubscriptions.remove'],
    { preHandler: [requireAuth, limited] },
    async (request, { body: { endpoint } }) => {
      const user = currentUser(request);
      // Yours only; anyone else's endpoint is left alone, and says nothing.
      await db
        .delete(pushSubscriptions)
        .where(
          and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, user.id)),
        );
      return undefined;
    },
  );
}
