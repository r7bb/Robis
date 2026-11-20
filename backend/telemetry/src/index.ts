import {
  type Attributes,
  type Context,
  context,
  propagation,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  type SpanExporter,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';

/**
 * Traces across the services (A5): OpenTelemetry (Apache-2.0), W3C trace
 * context between them, and the trace carried inside each queued job, so a
 * comment's mention shows as one trace from the request to the delivered
 * notification.
 *
 * Off unless `OTEL_EXPORTER_OTLP_ENDPOINT` names a collector: with no
 * provider registered, every call here is a no-op and costs next to
 * nothing, and no span leaves the process. Spans carry ids, routes, kinds
 * and status codes, never what anyone wrote.
 */

export { SpanKind };

const TRACER = 'robis';

export type TracingOptions = {
  /** `service.name` on every span: api, realtime, worker, mcp. */
  service: string;
  /** Where to send spans (OTLP over HTTP); none means tracing stays off. */
  endpoint?: string;
  /** For tests: spans go here instead, processed as they end. */
  processor?: SpanProcessor;
};

let provider: BasicTracerProvider | null = null;

/** Start tracing for this process, once, if there is somewhere to send spans. */
export function startTracing({ service, endpoint, processor }: TracingOptions): {
  stop: () => Promise<void>;
} {
  // The propagator and context manager are cheap and make the ids flow even
  // without an exporter, so a log line can still name its trace.
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  const processors: SpanProcessor[] = [];
  if (processor) processors.push(processor);
  else if (endpoint) {
    processors.push(new BatchSpanProcessor(exporterFor(endpoint)));
  }
  if (processors.length === 0 || provider) return { stop: async () => undefined };
  provider = new BasicTracerProvider({
    resource: resourceFromAttributes({ 'service.name': service }),
    spanProcessors: processors,
  });
  trace.setGlobalTracerProvider(provider);
  return { stop: stopTracing };
}

/** Flush and stop: spans after this are no-ops until tracing starts again. */
export async function stopTracing(): Promise<void> {
  const running = provider;
  provider = null;
  trace.disable();
  await running?.shutdown();
}

/**
 * Tracing as the environment asks (A5): spans to the OTLP collector at
 * `OTEL_EXPORTER_OTLP_ENDPOINT` (http or https) when it is set, otherwise
 * off. A value that is not such a URL stops the service rather than drop
 * every span without a word.
 */
export function startTracingFromEnv(
  service: string,
  env: Record<string, string | undefined> = process.env,
): { stop: () => Promise<void> } {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || undefined;
  if (endpoint) {
    let protocol = '';
    try {
      protocol = new URL(endpoint).protocol;
    } catch {
      // Reported below.
    }
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new Error(`OTEL_EXPORTER_OTLP_ENDPOINT is not an http(s) URL: ${endpoint}`);
    }
  }
  return startTracing({ service, endpoint });
}

function exporterFor(endpoint: string): SpanExporter {
  const base = endpoint.replace(/\/+$/, '');
  return new OTLPTraceExporter({ url: `${base}/v1/traces` });
}

const tracer = () => trace.getTracer(TRACER);

/**
 * Run `work` in a span, ended when it settles, recording an error as the
 * span's status. The span is the active one inside, so spans and jobs
 * started there are its children.
 */
export function inSpan<T>(
  name: string,
  options: { kind?: SpanKind; attributes?: Attributes; parent?: Context },
  work: (span: Span) => Promise<T>,
): Promise<T> {
  const parent = options.parent ?? context.active();
  return tracer().startActiveSpan(
    name,
    { kind: options.kind ?? SpanKind.INTERNAL, attributes: options.attributes },
    parent,
    async (span) => {
      try {
        return await work(span);
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

/** Start a span by hand, for a request whose end is a hook away. */
export function startSpan(
  name: string,
  options: { kind?: SpanKind; attributes?: Attributes; parent?: Context },
): { span: Span; context: Context } {
  const parent = options.parent ?? context.active();
  const span = tracer().startSpan(
    name,
    { kind: options.kind ?? SpanKind.INTERNAL, attributes: options.attributes },
    parent,
  );
  return { span, context: trace.setSpan(parent, span) };
}

/** Run `work` with `ctx` as the active context. */
export function within<T>(ctx: Context, work: () => T): T {
  return context.with(ctx, work);
}

/** End a span, as an error if `failed`. */
export function endSpan(span: Span, failed = false): void {
  if (failed) span.setStatus({ code: SpanStatusCode.ERROR });
  span.end();
}

/** The active trace as a W3C `traceparent` header value, or null when there is none. */
export function currentTraceparent(): string | null {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier.traceparent ?? null;
}

/** The context a `traceparent` (from a header or a queued job) continues, or the root. */
export function contextFrom(traceparent: string | null | undefined): Context {
  if (!traceparent) return context.active();
  return propagation.extract(context.active(), { traceparent });
}

/** The active span's ids, for a log line; null when there is none. */
export function currentIds(): { traceId: string; spanId: string } | null {
  const span = trace.getSpan(context.active());
  const ids = span?.spanContext();
  if (!ids || !trace.isSpanContextValid(ids)) return null;
  return { traceId: ids.traceId, spanId: ids.spanId };
}
