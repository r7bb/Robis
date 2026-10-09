import { afterAll, describe, expect, test } from 'bun:test';
import { requestIdFrom, trustProxySetting } from '@robis/api/hardening';
import Fastify from 'fastify';
import config from '../frontend/next.config.ts';
import { closeHarness, request } from './harness.ts';

afterAll(closeHarness);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('trustProxySetting', () => {
  test('trusts no proxy by default', () => {
    expect(trustProxySetting('')).toBe(false);
    expect(trustProxySetting(undefined)).toBe(false);
  });

  test('a hop count trusts exactly that many proxies', () => {
    const trust = trustProxySetting('1') as (address: string, hop: number) => boolean;

    expect(trust('10.0.0.2', 0)).toBe(true);
    expect(trust('10.0.0.3', 1)).toBe(false);
  });

  test('a named range or a list of addresses', () => {
    expect(trustProxySetting('loopback')).toBe('loopback');
    expect(trustProxySetting('10.0.0.0/8, 127.0.0.1')).toEqual(['10.0.0.0/8', '127.0.0.1']);
  });

  test('refuses "true", which would trust any client to name its own address', () => {
    expect(() => trustProxySetting('true')).toThrow(/TRUST_PROXY/);
  });
});

/** A bare app reporting the address Fastify settled on, under a given setting. */
function ipApp(setting: string) {
  const app = Fastify({ trustProxy: trustProxySetting(setting) });
  app.get('/ip', (req) => ({ ip: req.ip }));
  return app;
}

describe('the client address', () => {
  test('a spoofed X-Forwarded-For is ignored when no proxy is trusted', async () => {
    const response = await ipApp('').inject({
      url: '/ip',
      remoteAddress: '203.0.113.9',
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });

    // The rate limiter keys on this, so a client that could set it could
    // walk past every per-IP limit by changing a header.
    expect(response.json().ip).toBe('203.0.113.9');
  });

  test('behind one trusted hop the forwarded address is used', async () => {
    const response = await ipApp('1').inject({
      url: '/ip',
      remoteAddress: '10.0.0.2',
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });

    expect(response.json().ip).toBe('1.2.3.4');
  });
});

describe('request ids', () => {
  test('keeps a well-formed incoming id, so a trace can cross services', () => {
    expect(requestIdFrom('trace-abc_123XYZ')).toBe('trace-abc_123XYZ');
  });

  test.each([
    ['nothing', undefined],
    ['an empty header', ''],
    ['something too short', 'abc'],
    ['something too long', 'x'.repeat(200)],
    ['spaces', 'has a space in it'],
    ['markup', '<script>alert(1)</script>'],
    ['a log-forging newline', 'abcdefgh\nlevel=error'],
  ])('mints a fresh id for %s', (_label, value) => {
    expect(requestIdFrom(value)).toMatch(UUID);
  });

  test('every response carries the id it was handled under', async () => {
    const response = await request('/health', { headers: { 'x-request-id': 'trace-abc-12345' } });

    expect(response.headers['x-request-id']).toBe('trace-abc-12345');
  });

  test('a malformed incoming id is replaced, never echoed back', async () => {
    const response = await request('/health', { headers: { 'x-request-id': 'bad id!' } });

    expect(response.headers['x-request-id']).toMatch(UUID);
  });
});

describe('pages that carry a token in the URL', () => {
  test.each(['/reset-password', '/verify-email'])(
    '%s sends no referrer and is never cached',
    async (path) => {
      const rules = (await config.headers?.()) ?? [];
      const rule = rules.find((candidate) => candidate.source === path);
      const headers = Object.fromEntries((rule?.headers ?? []).map((h) => [h.key, h.value]));

      // A link clicked on the page would otherwise send the token to that
      // site in the Referer, and a shared cache could keep the page.
      expect(headers['Referrer-Policy']).toBe('no-referrer');
      expect(headers['Cache-Control']).toBe('no-store');
    },
  );
});
