import cookie from '@fastify/cookie';
import { sessionCookieName } from '@robis/auth';
import type { Database } from '@robis/database';
import { openApiDocument } from '@robis/shared';
import { type MediaStorage, storageFromEnv } from '@robis/storage';
import { API_LOG_FORMAT, apiLogMixin } from '@robis/telemetry/log';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Env } from './env.ts';
import { ApiError } from './errors.ts';
import {
  apiSecurityHeaders,
  isForeignWrite,
  requestIdFrom,
  trustProxySetting,
} from './hardening.ts';
import { operatorsFrom } from './insights/operators.ts';
import { DECODE_RETRY_AFTER_SECONDS, ImagesBusyError } from './media/images.ts';
import { createMetrics, registerMetrics } from './metrics.ts';
import { recordAgentSteps } from './plugins/agent-steps.ts';
import { attachUser } from './plugins/authz.ts';
import { processRateStore } from './plugins/rate-limit.ts';
import { postgresRateStore, type RateStore, withBackstop } from './plugins/rate-store.ts';
import { registerSyncLag } from './plugins/sync-lag.ts';
import { registerTracing } from './plugins/tracing.ts';
import { accountDeletionRoutes } from './routes/account-deletion.ts';
import { accountEventRoutes } from './routes/account-events.ts';
import { agentUndoRoutes } from './routes/agent-undo.ts';
import { agentRoutes } from './routes/agents.ts';
import { assistRoutes } from './routes/assist.ts';
import { attachmentRoutes } from './routes/attachments.ts';
import { auditRoutes } from './routes/audit.ts';
import { authRoutes } from './routes/auth.ts';
import { authRecoveryRoutes } from './routes/auth-recovery.ts';
import { automationRoutes } from './routes/automations.ts';
import { avatarRoutes } from './routes/avatars.ts';
import { calendarRoutes } from './routes/calendar.ts';
import { calendarImportRoutes } from './routes/calendar-import.ts';
import { channelRoutes } from './routes/channels.ts';
import { commentRoutes } from './routes/comments.ts';
import { consentRoutes } from './routes/consent.ts';
import { discussionRoutes } from './routes/discussion.ts';
import { documentRoutes } from './routes/documents.ts';
import { exportRoutes } from './routes/exports.ts';
import { feedRoutes } from './routes/feed.ts';
import { feedHighlightRoutes } from './routes/feed-highlights.ts';
import { feedbackRoutes } from './routes/feedback.ts';
import { followRoutes } from './routes/follows.ts';
import { githubRoutes } from './routes/github.ts';
import { importRoutes } from './routes/imports.ts';
import { insightRoutes } from './routes/insights.ts';
import { invitationRoutes } from './routes/invitations.ts';
import { issueRoutes } from './routes/issues.ts';
import { bulkIssueRoutes } from './routes/issues-bulk.ts';
import { labelRoutes } from './routes/labels.ts';
import { meetingRoutes } from './routes/meetings.ts';
import { memberRoutes } from './routes/members.ts';
import { messageImageRoutes } from './routes/message-images.ts';
import { myMeetingRoutes } from './routes/my-meetings.ts';
import { notificationSettingRoutes } from './routes/notification-settings.ts';
import { notificationRoutes } from './routes/notifications.ts';
import { overviewRoutes } from './routes/overview.ts';
import { passkeyRoutes } from './routes/passkeys.ts';
import { personalTokenRoutes } from './routes/personal-tokens.ts';
import { postRoutes } from './routes/posts.ts';
import { profileRoutes } from './routes/profiles.ts';
import { projectRoutes } from './routes/projects.ts';
import { pushKey, pushRoutes } from './routes/push.ts';
import { savedViewRoutes } from './routes/saved-views.ts';
import { searchRoutes } from './routes/search.ts';
import { signupRoutes } from './routes/signup.ts';
import { spaceRoutes } from './routes/spaces.ts';
import { storyRoutes } from './routes/stories.ts';
import { todayRoutes } from './routes/today.ts';
import { twoFactorRoutes } from './routes/two-factor.ts';
import { webhookRoutes } from './routes/webhooks.ts';
import { weekRoutes } from './routes/week.ts';
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
  /** Push devices turned on or off, per address (C3): rare for a person. */
  pushDevicesPerMinute: number;
};

export const DEFAULT_RATE_LIMITS: RateLimits = {
  authPerMinute: 10,
  searchPerMinute: 60,
  pushDevicesPerMinute: 20,
  passwordForgotPerHourPerAddress: 3,
  auditVerifyPerMinute: 10,
  auditFullVerifyPerMinute: 2,
};

export type AppDeps = {
  db: Database;
  env: Env;
  /**
   * Quiet by default in tests; `main.ts` turns logging on. A stream sends
   * the JSON lines there instead of stdout, for a test that reads them.
   */
  logger?: boolean | { stream: { write(line: string): void } };
  rateLimits?: Partial<RateLimits>;
  /** Where rate counts live; `RATE_LIMIT_STORE` decides, unless a test supplies one. */
  rateStore?: RateStore;
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

/**
 * The rate store `RATE_LIMIT_STORE` names (A6): shared in Postgres, the
 * default in production, with this process's memory behind it for when the
 * database cannot answer; or this process's memory alone. `main.ts` hands
 * it a small pool of its own with a short statement timeout.
 */
export function rateStoreFromEnv(env: Env, db: Database): RateStore {
  const driver = env.RATE_LIMIT_STORE ?? (env.NODE_ENV === 'production' ? 'postgres' : 'memory');
  return driver === 'postgres'
    ? withBackstop(postgresRateStore(db), processRateStore)
    : processRateStore;
}

export function buildApp({
  db,
  env,
  logger = false,
  rateLimits,
  rateStore = rateStoreFromEnv(env, db),
  suggestions,
  storage = storageFromEnv(env),
  signupFloorMs,
}: AppDeps): FastifyInstance {
  const limits: RateLimits = { ...DEFAULT_RATE_LIMITS, ...rateLimits };
  // Typed as plain HTTP/1 options so Fastify picks that overload: a union
  // in `trustProxy` alone otherwise steers inference towards HTTP/2.
  const options: FastifyServerOptions = {
    // JSON lines, each with the request id (`reqId`) and the trace and span
    // it was written in (A5).
    // Written by the tracing hooks instead, inside each request's span.
    disableRequestLogging: true,
    logger: logger
      ? {
          ...API_LOG_FORMAT,
          mixin: apiLogMixin,
          ...(typeof logger === 'object' ? { stream: logger.stream } : {}),
        }
      : false,
    trustProxy: trustProxySetting(env.TRUST_PROXY),
    // Every log line for a request carries this id, and so does the
    // response. A well-formed incoming one is kept so a trace can cross
    // services; anything else is replaced (see `requestIdFrom`).
    genReqId: (req) => requestIdFrom(req.headers['x-request-id']),
  };
  const app = Fastify(options);

  app.decorate('sessionCookieName', sessionCookieName(env.NODE_ENV));
  app.decorate('rateStore', rateStore);
  // First, so everything a request does runs inside its span (A5).
  registerTracing(app);

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
  const metrics = createMetrics();
  const suggest =
    suggestions ??
    createSuggestionClient(
      {
        url: env.ML_SERVICE_URL || null,
        token: env.ML_SERVICE_TOKEN || null,
        timeoutMs: env.ML_TIMEOUT_MS,
      },
      app.log,
      (outcome) => metrics.mlCalls.inc({ outcome }),
    );

  // Before `attachUser`, so the in-flight gauge and the duration histogram
  // include time spent resolving the session rather than starting after it.
  registerMetrics(app, metrics);
  // Each process's own source, so two API instances never write one row.
  registerSyncLag(app, { db, metrics, source: `api-${crypto.randomUUID()}` });

  app.addHook('preHandler', attachUser(db));
  // What agents do, step by step, once each call is answered (B6).
  app.addHook('onResponse', recordAgentSteps(db));

  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    }

    // Every decode slot and place in line is taken (stage 3, item 31): a
    // passing condition, so the client is told when to come back.
    if (error instanceof ImagesBusyError) {
      reply.header('retry-after', String(DECODE_RETRY_AFTER_SECONDS));
      return reply.status(503).send({ error: 'images_busy', message: error.message });
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
  // The OpenAPI document (C7), built once from the contracts, for tools to import.
  const openApi = openApiDocument();
  app.get('/openapi.json', async (_request, reply) =>
    reply.header('cache-control', 'public, max-age=300').send(openApi),
  );

  app.register(authRoutes, { db, env, limits });
  app.register(twoFactorRoutes, { db, env, limits });
  app.register(passkeyRoutes, { db, env, limits });
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
  app.register(agentRoutes, { db });
  app.register(feedbackRoutes, { db });
  app.register(labelRoutes, { db });
  app.register(bulkIssueRoutes, { db });
  app.register(savedViewRoutes, { db });
  app.register(invitationRoutes, { db });
  app.register(consentRoutes, { db });
  app.register(projectRoutes, { db });
  app.register(issueRoutes, { db, suggestions: suggest });
  app.register(discussionRoutes, { db });
  app.register(agentUndoRoutes, { db });
  app.register(myMeetingRoutes, { db });
  app.register(commentRoutes, { db });
  app.register(documentRoutes, { db });
  app.register(channelRoutes, { db });
  app.register(meetingRoutes, { db });
  app.register(notificationRoutes, { db });
  app.register(notificationSettingRoutes, { db, limits });
  app.register(pushRoutes, { db, limits, publicKey: pushKey(env.VAPID_PUBLIC_KEY) });
  app.register(auditRoutes, { db, limits });
  app.register(accountEventRoutes, { db, limits });
  app.register(avatarRoutes, { db, storage });
  app.register(attachmentRoutes, { db, storage });
  app.register(storyRoutes, { db, storage });
  app.register(profileRoutes, { db, storage });
  app.register(messageImageRoutes, { db, storage });
  app.register(postRoutes, { db, storage });
  app.register(feedRoutes, { db });
  app.register(feedHighlightRoutes, { db });
  app.register(spaceRoutes, { db });
  app.register(followRoutes, { db });
  app.register(todayRoutes, { db });
  app.register(assistRoutes, { db, keyed: env.SUMMARY_API_KEY !== '' });
  app.register(insightRoutes, { db, operators: operatorsFrom(env.HEALTH_OPERATORS) });
  app.register(calendarRoutes, { db, webOrigin: env.WEB_ORIGIN });
  app.register(calendarImportRoutes, { db });
  app.register(weekRoutes, { db });
  app.register(automationRoutes, { db });
  app.register(exportRoutes, { db, storage });
  app.register(importRoutes, { db });
  app.register(webhookRoutes, { db });
  app.register(personalTokenRoutes, { db });
  app.register(githubRoutes, { db });
  app.register(searchRoutes, { db, limits });

  return app;
}
