import { Registry } from '@relay/metrics';
import type { FastifyInstance } from 'fastify';

/**
 * HTTP metrics for the API.
 *
 * The one decision here that matters is the `route` label. It carries the
 * route *pattern* -- `/workspaces/:workspaceId/issues/:issueId` -- not the
 * requested path. Using the path would mint a new time series for every issue
 * anyone has ever opened: unbounded memory in the registry, an unbounded index
 * in whatever scrapes it, and a dashboard that cannot aggregate because no two
 * requests share a series.
 *
 * Requests that match no route are labelled `__unmatched__` for the same
 * reason. A 404 sweep is exactly the traffic that would otherwise produce a
 * million distinct labels, and it is also the traffic least worth describing
 * individually.
 *
 * No label carries a workspace id, user id or email. Metrics tend to be the
 * least access-controlled surface a service has, so they hold operational
 * shape and nothing about who was asking.
 */

export type ApiMetrics = ReturnType<typeof createMetrics>;

export function createMetrics() {
  const registry = new Registry();

  const requests = registry.counter(
    'relay_http_requests_total',
    'HTTP requests, by method, route pattern and status.',
    ['method', 'route', 'status'],
  );

  const duration = registry.histogram(
    'relay_http_request_duration_seconds',
    'HTTP request duration in seconds.',
    ['method', 'route'],
  );

  const inFlight = registry.gauge(
    'relay_http_requests_in_flight',
    'Requests currently being served.',
  );

  const started = Date.now();
  registry
    .gauge('relay_process_uptime_seconds', 'Seconds since this process started.')
    .collect(() => (Date.now() - started) / 1000);

  return { registry, requests, duration, inFlight };
}

/**
 * Status is bucketed to its class for the duration histogram's sake elsewhere,
 * but kept exact on the counter -- distinguishing 401 from 403 is most of what
 * an auth dashboard is for, and the cardinality is bounded by the spec.
 */
export function registerMetrics(app: FastifyInstance, metrics: ApiMetrics) {
  app.addHook('onRequest', async () => {
    metrics.inFlight.inc();
  });

  app.addHook('onResponse', async (request, reply) => {
    metrics.inFlight.dec();

    // `routeOptions.url` is the pattern Fastify matched; it is undefined when
    // nothing matched, which is the case the fallback exists for.
    const route = request.routeOptions.url ?? '__unmatched__';
    const method = request.method;

    metrics.requests.inc({ method, route, status: String(reply.statusCode) });
    // Fastify measures in milliseconds; Prometheus convention is seconds.
    metrics.duration.observe({ method, route }, reply.elapsedTime / 1000);
  });

  /**
   * Unauthenticated, deliberately.
   *
   * It exposes route names, counts and latencies -- operational shape, no
   * tenant data -- and a scraper holding a session cookie is its own problem.
   * In a real deployment this belongs on an internal port that is not routed
   * from the internet; here there is one port, so the mitigation is that
   * there is nothing sensitive in the response.
   */
  app.get('/metrics', async (_request, reply) => {
    reply.header('content-type', Registry.CONTENT_TYPE);
    return metrics.registry.render();
  });
}
