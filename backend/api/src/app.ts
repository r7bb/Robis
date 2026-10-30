import cookie from '@fastify/cookie';
import { sessionCookieName } from '@robis/auth';
import type { Database } from '@robis/database';
import { type MediaStorage, storageFromEnv } from '@robis/storage';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Env } from './env.ts';
import { ApiError } from './errors.ts';
import {
  apiSecurityHeaders,
  isForeignWrite,
  requestIdFrom,
  trustProxySetting,
} from './hardening.ts';
import { createMetrics, registerMetrics } from './metrics.ts';
import { attachUser } from './plugins/authz.ts';
import { accountDeletionRoutes } from './routes/account-deletion.ts';
import { accountEventRoutes } from './routes/account-events.ts';
import { attachmentRoutes } from './routes/attachments.ts';
import { auditRoutes } from './routes/audit.ts';
import { authRoutes } from './routes/auth.ts';
import { authRecoveryRoutes } from './routes/auth-recovery.ts';
import { avatarRoutes } from './routes/avatars.ts';
import { channelRoutes } from './routes/channels.ts';
import { commentRoutes } from './routes/comments.ts';
import { consentRoutes } from './routes/consent.ts';
import { documentRoutes } from './routes/documents.ts';
import { invitationRoutes } from './routes/invitations.ts';
import { issueRoutes } from './routes/issues.ts';
import { meetingRoutes } from './routes/meetings.ts';
import { memberRoutes } from './routes/members.ts';
import { notificationRoutes } from './routes/notifications.ts';
import { overviewRoutes } from './routes/overview.ts';
import { projectRoutes } from './routes/projects.ts';
import { searchRoutes } from './routes/search.ts';
import { signupRoutes } from './routes/signup.ts';
import { workspaceRoutes } from './routes/workspaces.ts';
import { createSuggestionClient, type SuggestionClient } from './suggestions.ts';

/**
 * Per-minute request budgets, injectable so tests can exercise the limiter
 * with a small number instead of disabling it. Turning rate limiting off in
 * tests would mean the only code path anyone runs is the untested one.
 */

declare module 'fastify' {
  interface FastifyInstance {
    /** Method and path of every route the app registered, HEAD aside. */
    registeredRoutes: readonly { method: string; url: string }[];
  }
}

export type RateLimits = {
  /** Register and login, per address. */
  authPerMinute: number;
  /** Full-text search, per account. */
  searchPerMinute: number;
  /**
   * Reset links per hour for one email address.
   *
   * Separate from `authPerMinute` because it answers a different question.
   * That one protects the server from a caller; this protects a *recipient*
   * from being mail-bombed by callers who each stay under their own limit.
   */
  passwordForgotPerHourPerAddress: number;
  /**
   * Audit chain verifications, per account. Each one walks and hashes the
   * workspace's whole trail, so it is the costliest read an admin can ask for.
   */
  auditVerifyPerMinute: number;
  /**
   * Full verifications, which ignore the checkpoint and walk the whole trail
   * from the first event: the expensive form, so far fewer of them.
   */
  auditFullVerifyPerMinute: number;
};

export const DEFAULT_RATE_LIMITS: RateLimits = {
  authPerMinute: 10,
  searchPerMinute: 60,
  passwordForgotPerHourPerAddress: 3,
  auditVerifyPerMinute: 10,
  auditFullVerifyPerMinute: 2,
};

export type AppDeps = {
  db: Database;
  env: Env;
  /** Quiet by default in tests; `main.ts` turns logging on. */
  logger?: boolean;
  rateLimits?: Partial<RateLimits>;
  /**
   * Duplicate-issue suggestions. Off unless a URL is configured.
   *
   * Injected rather than constructed here so tests can supply a stub and
   * never reach the network, and so the API has no opinion about whether
   * the ML service exists.
   */
  suggestions?: SuggestionClient;
  /** Uploaded files: the driver `STORAGE_DRIVER` names, unless a test supplies one. */
  storage?: MediaStorage;
  /**
   * The least time starting a sign-up takes to answer, so its two branches
   * cannot be told apart by timing. Tests set it to 0, having nothing to
   * hide from themselves and hundreds of sign-ups to make.
   */
  signupFloorMs?: number;
};

export function buildApp({
  db,
  env,
  logger = false,
  rateLimits,
  suggestions,
  storage = storageFromEnv(env),
  signupFloorMs,
}: AppDeps): FastifyInstance {
  const limits: RateLimits = { ...DEFAULT_RATE_LIMITS, ...rateLimits };
  // Typed as plain HTTP/1 options so Fastify picks that overload: a union
  // in `trustProxy` alone otherwise steers inference towards HTTP/2.
  const options: FastifyServerOptions = {
    logger,
    trustProxy: trustProxySetting(env.TRUST_PROXY),
    // Every log line for a request carries this id, and so does the
    // response. A well-formed incoming one is kept so a trace can cross
    // services; anything else is replaced (see `requestIdFrom`).
    genReqId: (req) => requestIdFrom(req.headers['x-request-id']),
  };
  const app = Fastify(options);

  app.decorate('sessionCookieName', sessionCookieName(env.NODE_ENV));

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    // The API serves JSON and raster images, never a page: opened directly,
    // nothing it returns may run script or be framed.
    reply.headers(apiSecurityHeaders(env.NODE_ENV === 'production'));
    // Before the body is read or a session resolved: a write from another
    // site is refused whatever it carries (see `isForeignWrite`).
    if (isForeignWrite(request.method, request.headers, env.WEB_ORIGIN)) {
      return reply
        .status(403)
        .send({ error: 'forbidden_origin', message: 'Writes are only accepted from the web app' });
    }
  });

  app.register(cookie);
  // No CORS: the web app reaches the API on its own origin, at /api behind
  // the edge proxy (and through a rewrite in development), so no response
  // needs to be readable by another site, and none says it may be.

  /*
   * Built here rather than by the caller because it needs `app.log`, and
   * `app` does not exist until the line above. An earlier version passed it
   * into `buildApp` from `main.ts` and referenced `app.log` inside `app`'s
   * own initialiser, which is a temporal dead zone and throws.
   *
   * An injected client still wins, so tests supply a stub and never reach
   * the network. With no URL configured this is the switched-off client and
   * the endpoint returns an empty list.
   */
  const suggest =
    suggestions ??
    createSuggestionClient(
      {
        url: env.ML_SERVICE_URL || null,
        token: env.ML_SERVICE_TOKEN || null,
        timeoutMs: env.ML_TIMEOUT_MS,
      },
      app.log,
    );

  // Before `attachUser`, so the in-flight gauge and the duration histogram
  // include time spent resolving the session rather than starting after it.
  registerMetrics(app, createMetrics());

  app.addHook('preHandler', attachUser(db));

  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    }

    // Fastify's own errors (malformed JSON, payload too large) already carry a
    // client-safe 4xx status and message.
    if (typeof error.statusCode === 'number' && error.statusCode < 500) {
      return reply
        .status(error.statusCode)
        .send({ error: error.code ?? 'bad_request', message: error.message });
    }

    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({ error: 'internal_error', message: 'Something went wrong' });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: 'not_found', message: 'Not found' }),
  );

  // Every route as registered, so a test can hold each one to a contract
  // (stage 2, item 20). Fastify adds a HEAD beside every GET; those are its own.
  const registeredRoutes: { method: string; url: string }[] = [];
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) {
      if (method !== 'HEAD') registeredRoutes.push({ method, url: route.url });
    }
  });
  app.decorate('registeredRoutes', registeredRoutes);

  app.get('/health', async () => ({ status: 'ok' }));

  app.register(authRoutes, { db, env, limits });
  app.register(authRecoveryRoutes, { db, env, limits });
  app.register(signupRoutes, { db, limits, floorMs: signupFloorMs });
  app.register(workspaceRoutes, { db });
  app.register(overviewRoutes, { db });
  app.register(accountDeletionRoutes, {
    db,
    // The same attributes the cookie was set with, so the browser drops it.
    clearSession: (reply) =>
      reply.clearCookie(app.sessionCookieName, {
        httpOnly: true,
        sameSite: 'lax',
        secure: env.NODE_ENV === 'production' || env.COOKIE_SECURE,
        path: '/',
      }),
  });
  app.register(memberRoutes, { db });
  app.register(invitationRoutes, { db });
  app.register(consentRoutes, { db });
  app.register(projectRoutes, { db });
  app.register(issueRoutes, { db, suggestions: suggest });
  app.register(commentRoutes, { db });
  app.register(documentRoutes, { db });
  app.register(channelRoutes, { db });
  app.register(meetingRoutes, { db });
  app.register(notificationRoutes, { db });
  app.register(auditRoutes, { db, limits });
  app.register(accountEventRoutes, { db, limits });
  app.register(avatarRoutes, { db, storage });
  app.register(attachmentRoutes, { db, storage });
  app.register(searchRoutes, { db, limits });

  return app;
}
