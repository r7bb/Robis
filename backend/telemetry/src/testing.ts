import {
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { startTracing, stopTracing } from './index.ts';

/**
 * Tracing for tests (A5): spans kept in memory as they end, so a test can
 * read back the trace a request and its jobs made. Once per process; every
 * caller shares the one exporter.
 */

let exporter: InMemorySpanExporter | null = null;

export function traceInMemory(): {
  spans: () => ReadableSpan[];
  clear: () => void;
  /** Stop recording, so later test files do not fill memory with spans. */
  stop: () => Promise<void>;
} {
  if (!exporter) {
    exporter = new InMemorySpanExporter();
    startTracing({ service: 'test', processor: new SimpleSpanProcessor(exporter) });
  }
  const kept = exporter;
  return {
    spans: () => kept.getFinishedSpans(),
    clear: () => kept.reset(),
    stop: async () => {
      kept.reset();
      exporter = null;
      await stopTracing();
    },
  };
}
