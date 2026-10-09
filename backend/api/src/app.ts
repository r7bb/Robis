import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import type { Database } from '@robis/database';
import { ConsoleMailer, type Mailer } from '@robis/mailer';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Env } from './env.ts';
import { ApiError } from './errors.ts';
import { requestIdFrom, trustProxySetting } from './hardening.ts';
import { createMetrics, registerMetrics } from './metrics.ts';
import { attachUser } from './plugins/authz.ts';
import { authRoutes } from './routes/auth.ts';
import { authRecoveryRoutes } from './routes/auth-recovery.ts';
import { channelRoutes } from './routes/channels.ts';
import { commentRoutes } from './routes/comments.ts';
import { documentRoutes } from './routes/documents.ts';
import { issueRoutes } from './routes/issues.ts';
import { meetingRoutes } from './routes/meetings.ts';
import { memberRoutes } from './routes/members.ts';
import { notificationRoutes } from './routes/notifications.ts';
import { projectRoutes } from './routes/projects.ts';
import { searchRoutes } from './routes/search.ts';
import { workspaceRoutes } from './routes/workspaces.ts';
import { createSuggestionClient, type SuggestionClient } from './suggestions.ts';

/**
 * Per-minute request budgets, injectable so tests can exercise the limiter
 * with a small number instead of disabling it. Turning rate limiting off in
 * tests would mean the only code path anyone runs is the untested one.
 */
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
};

export const DEFAULT_RATE_LIMITS: RateLimits = {
  authPerMinute: 10,
  searchPerMinute: 60,
  passwordForgotPerHourPerAddress: 3,
};

export type AppDeps = {
  db: Database;
  env: Env;
  /**
   * Where outgoing mail goes. Defaults to the console driver, which is the
   * right default for a repo with no mail provider configured: the reset link
   * is printed where a developer will see it rather than silently dropped.
   */
  mailer?: Mailer;
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
};

export function buildApp({
  db,
  env,
  logger = false,
  rateLimits,
  mailer = new ConsoleMailer(),
  suggestions,
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

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.register(cookie);
  app.register(cors, {
    // Cookies are only sent cross-origin when the origin is explicitly allowed
    // and credentials are enabled; a wildcard would silently disable both.
    origin: env.WEB_ORIGIN,
    credentials: true,
  });

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

  app.get('/health', async () => ({ status: 'ok' }));

  app.register(authRoutes, { db, env, limits, mailer });
  app.register(authRecoveryRoutes, { db, env, limits, mailer });
  app.register(workspaceRoutes, { db });
  app.register(memberRoutes, { db });
  app.register(projectRoutes, { db });
  app.register(issueRoutes, { db, suggestions: suggest });
  app.register(commentRoutes, { db });
  app.register(documentRoutes, { db });
  app.register(channelRoutes, { db });
  app.register(meetingRoutes, { db });
  app.register(notificationRoutes, { db });
  app.register(searchRoutes, { db, limits });

  return app;
}
