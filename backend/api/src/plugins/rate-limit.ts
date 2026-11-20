import type { Executor } from '@robis/database';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { ApiError } from '../errors.ts';
import { networkOf } from './client-network.ts';
import { type Hit, memoryRateStore, type RateStore } from './rate-store.ts';

/**
 * Fixed-window rate limiting, counted in the app's rate store (A6).
 *
 * The store is memory for tests and a single instance in development, and
 * Postgres in production, so several API instances enforce one combined
 * budget instead of each allowing the whole of it. See `rate-store.ts`.
 *
 * A fixed window rather than a sliding one: it is a counter and a
 * timestamp. The known weakness is a burst spanning a window boundary
 * landing up to 2x the limit, which is acceptable for throttling credential
 * stuffing and not acceptable for billing.
 *
 * In production the shared store has a memory store behind it, so a
 * database that is slow or down loosens the limits to per instance rather
 * than turning them off. Only if no store at all can count does the
 * request go ahead, logged: failing closed would turn a blip into everyone
 * locked out.
 */

declare module 'fastify' {
  interface FastifyInstance {
    /** Where this app's rate counts live (A6). */
    rateStore: RateStore;
  }
}

export type RateLimitOptions = {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
  /** Distinguishes one limiter's buckets from another's. */
  name: string;
  /**
   * What to count per, instead of the caller.
   *
   * The default is "who is asking", which is the right question for login.
   * It is the wrong question for a reset request: there the abuse is aimed at
   * a *recipient*, and the attacker supplies the address, so limiting by
   * caller lets anyone with a handful of addresses flood one mailbox.
   * Returning null falls back to the caller.
   */
  key?: (request: FastifyRequest) => string | null;
};

/**
 * The memory store an app uses when it is given none: one per process, so
 * tests clear it between cases with `resetRateLimits`.
 */
export const processRateStore = memoryRateStore();

/** Exported for tests, which need a clean slate between cases. */
export function resetRateLimits() {
  processRateStore.clear();
}

/**
 * Strikes against one subject (an account), counted in the same store as
 * the request limits. `strike` adds one and says how many there are;
 * `strikes` only looks. Both forget after the window. Unlike the request
 * limits these fail closed: a wrong-code count that cannot be read refuses
 * the code rather than allow unlimited guesses.
 */
export async function strike(
  store: RateStore,
  name: string,
  subject: string,
  windowMs: number,
  /** The transaction the caller is in, if any: counted on its connection. */
  within?: Executor,
): Promise<number> {
  return (await store.hit(`${name}:${subject}`, windowMs, { within })).count;
}

export async function strikes(
  store: RateStore,
  name: string,
  subject: string,
): Promise<{ count: number; resetInSeconds: number }> {
  const bucket = await store.peek(`${name}:${subject}`);
  if (!bucket) return { count: 0, resetInSeconds: 0 };
  return {
    count: bucket.count,
    resetInSeconds: Math.max(0, Math.ceil((bucket.resetAt - bucket.now) / 1000)),
  };
}

/**
 * Identify the caller.
 *
 * A signed-in user is limited per account, so sharing an office IP does not
 * mean sharing a quota. Anonymous traffic -- which is exactly where login
 * abuse lives -- falls back to the address, or for IPv6 its /64, which one
 * client usually holds whole.
 */
function identify(request: FastifyRequest): string {
  return request.user?.id ?? networkOf(request.ip);
}

async function count(request: FastifyRequest, key: string, windowMs: number): Promise<Hit | null> {
  try {
    return await request.server.rateStore.hit(key, windowMs);
  } catch (error) {
    request.log.warn({ err: error }, 'rate limit: store unreachable, request allowed');
    return null;
  }
}

export function rateLimit(options: RateLimitOptions): preHandlerHookHandler {
  const { limit, windowMs, name } = options;

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const subject = options.key?.(request) ?? identify(request);
    const bucket = await count(request, `${name}:${subject}`, windowMs);
    if (!bucket) return;

    const remaining = Math.max(0, limit - bucket.count);
    const resetSeconds = Math.max(0, Math.ceil((bucket.resetAt - bucket.now) / 1000));

    reply.header('ratelimit-limit', String(limit));
    reply.header('ratelimit-remaining', String(remaining));
    reply.header('ratelimit-reset', String(resetSeconds));

    if (bucket.count > limit) {
      // `Retry-After` tells a well-behaved client when to come back, and the
      // sync engine treats 429 as transient rather than dropping the mutation.
      reply.header('retry-after', String(resetSeconds));
      throw new ApiError(429, 'rate_limited', 'Too many requests. Try again shortly.');
    }
  };
}
