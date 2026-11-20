import { afterAll, describe, expect, test } from 'bun:test';
import { buildApp } from '@robis/api/app';
import { loadEnv } from '@robis/api/env';
import { inSpan } from '@robis/telemetry';
import { log, setLogService, setLogSink } from '@robis/telemetry/log';
import { traceInMemory } from '@robis/telemetry/testing';
import { getHarness, TEST_URL } from './harness.ts';

/**
 * Structured logs (A5). Done when: every line is one JSON object with its
 * service and level; a line written inside a span names that trace; an
 * error is logged by its name, message and stack; and the API's request
 * lines carry the request id and the trace id of that request.
 */

const tracing = traceInMemory();
afterAll(() => tracing.stop());

function capture() {
  const lines: Record<string, unknown>[] = [];
  const previous = setLogSink((line) => lines.push(JSON.parse(line)));
  return { lines, restore: () => setLogSink(previous) };
}

describe('the services’ log lines', () => {
  test('one JSON object each, with the service, level and the trace it was written in', async () => {
    const { lines, restore } = capture();
    setLogService('worker');
    log.info('outside any span');
    let traceId = '';
    await inSpan('a job', {}, async (span) => {
      traceId = span.spanContext().traceId;
      log.warn('inside the job', { jobKind: 'mail.mention' });
      log.error('the job failed', { err: new TypeError('no such column') });
    });
    restore();

    expect(lines[0]).toMatchObject({ level: 'info', service: 'worker', msg: 'outside any span' });
    expect(lines[0]).not.toHaveProperty('traceId');
    expect(lines[1]).toMatchObject({ level: 'warn', traceId, jobKind: 'mail.mention' });
    expect(lines[2]).toMatchObject({
      level: 'error',
      traceId,
      err: { name: 'TypeError', message: 'no such column' },
    });
    expect(typeof (lines[2]!.err as { stack?: string }).stack).toBe('string');
    expect(Date.parse(String(lines[0]!.time))).not.toBeNaN();
  });

  test('a field that cannot be written as JSON keeps the line', () => {
    const { lines, restore } = capture();
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    log.info('with a cycle', { loop });
    restore();
    expect(lines[0]).toMatchObject({ msg: 'with a cycle', unserialisable: true });
  });
});

describe('the API’s log lines', () => {
  test('carry the request id and the trace of the request', async () => {
    const { db } = await getHarness();
    const env = loadEnv({
      DATABASE_URL: TEST_URL,
      NODE_ENV: 'test',
      WEB_ORIGIN: 'http://localhost:3000',
    } as NodeJS.ProcessEnv);
    const written: Record<string, unknown>[] = [];
    const app = buildApp({
      db,
      env,
      logger: { stream: { write: (line) => written.push(JSON.parse(line)) } },
    });
    await app.ready();
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const reply = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { traceparent: `00-${traceId}-00f067aa0ba902b7-01`, 'x-request-id': 'req-one' },
    });
    await app.close();

    const ofRequest = written.filter((line) => line.reqId === reply.headers['x-request-id']);
    expect(ofRequest.length).toBeGreaterThan(0);
    for (const line of ofRequest) {
      expect(line).toMatchObject({ service: 'api', traceId });
      expect(typeof line.level).toBe('string');
    }
  });
});
