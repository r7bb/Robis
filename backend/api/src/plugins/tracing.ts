import { contextFrom, endSpan, SpanKind, startSpan, within } from '@robis/telemetry';
import type { FastifyInstance } from 'fastify';

/**
 * A span per request (A5), continuing the caller's trace when it sends a
 * W3C `traceparent`. Everything the request does runs inside it, so a job
 * it queues carries the trace on to the worker. Named by the route's
 * pattern, never the path itself (which holds ids), and carrying the
 * request id that log lines and the response share.
 */

declare module 'fastify' {
  interface FastifyRequest {
    /** This request's span, ended when the response is sent. */
    span: ReturnType<typeof startSpan>['span'] | null;
  }
}

export function registerTracing(app: FastifyInstance): void {
  app.decorateRequest('span', null);

  // A callback hook rather than an async one: `done` is called inside the
  // span's context, so every later hook and the handler run within it.
  app.addHook('onRequest', (request, _reply, done) => {
    const header = request.headers.traceparent;
    const { span, context } = startSpan(`HTTP ${request.method}`, {
      kind: SpanKind.SERVER,
      parent: contextFrom(typeof header === 'string' ? header : null),
      attributes: { 'http.request.method': request.method, 'robis.request_id': request.id },
    });
    request.span = span;
    within(context, () => {
      // Fastify's own request lines come before any hook, outside the
      // span; these replace them, inside it (A5).
      request.log.info({ req: { method: request.method, url: request.url } }, 'incoming request');
      done();
    });
  });

  app.addHook('onResponse', (request, reply, done) => {
    const span = request.span;
    if (span) {
      const route = request.routeOptions.url;
      if (route) {
        span.updateName(`${request.method} ${route}`);
        span.setAttribute('http.route', route);
      }
      span.setAttribute('http.response.status_code', reply.statusCode);
    }
    request.log.info(
      { res: { statusCode: reply.statusCode }, responseTime: reply.elapsedTime },
      'request completed',
    );
    if (span) endSpan(span, reply.statusCode >= 500);
    done();
  });
}
