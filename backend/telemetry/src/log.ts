import { currentIds } from './index.ts';

/**
 * Structured logs (A5): one JSON object per line, with the service, the
 * level, the message, and the trace and span the line was written in, so a
 * line found in the logs leads to its trace and back. The API's own lines
 * come from Fastify's logger with the same fields (`apiLogMixin`).
 *
 * Messages are written by the code, never by users: what someone wrote
 * does not belong in a log line, and errors are logged by their message
 * and stack, which name what failed rather than what was in it.
 */

type Level = 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

let service = 'robis';
let sink: (line: string, level: Level) => void = (line, level) => {
  (level === 'info' ? process.stdout : process.stderr).write(`${line}\n`);
};

/** Name the service every line says it came from. */
export function setLogService(name: string): void {
  service = name;
}

/** For tests: where lines go instead of stdout and stderr. Returns the previous sink. */
export function setLogSink(next: (line: string, level: Level) => void): typeof sink {
  const previous = sink;
  sink = next;
  return previous;
}

/** An error as a log can hold it: its kind, message and stack, nothing else. */
function errorFields(error: unknown): Fields {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

function write(level: Level, msg: string, fields: Fields = {}): void {
  const { err, ...rest } = fields;
  const ids = currentIds();
  const line: Fields = {
    time: new Date().toISOString(),
    level,
    service,
    msg,
    ...(ids ? { traceId: ids.traceId, spanId: ids.spanId } : {}),
    ...rest,
    ...(err === undefined ? {} : { err: errorFields(err) }),
  };
  let text: string;
  try {
    text = JSON.stringify(line);
  } catch {
    // A field that will not serialise (a cycle) must not lose the line.
    text = JSON.stringify({ time: line.time, level, service, msg, unserialisable: true });
  }
  sink(text, level);
}

export const log = {
  info: (msg: string, fields?: Fields) => write('info', msg, fields),
  warn: (msg: string, fields?: Fields) => write('warn', msg, fields),
  error: (msg: string, fields?: Fields) => write('error', msg, fields),
};

/** The trace and span for Fastify's logger to add to each of its lines. */
export function apiLogMixin(): Fields {
  const ids = currentIds();
  return ids ? { traceId: ids.traceId, spanId: ids.spanId } : {};
}

/**
 * Fastify's logger (pino) set to write the same shape as `log`: level by
 * name, an ISO time, and the service, so one query reads every service.
 */
export const API_LOG_FORMAT = {
  base: { service: 'api' },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
  formatters: { level: (label: string) => ({ level: label }) },
};
