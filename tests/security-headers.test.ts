import { describe, expect, test } from 'bun:test';
import {
  contentSecurityPolicy,
  originOf,
  staticSecurityHeaders,
} from '@robis/web/lib/security-headers.ts';

/**
 * The web app's security headers (stage 1, item 5). The browser half,
 * `bun run smoke:browser`, loads real pages under this policy and fails on
 * any violation; this half pins what the policy says.
 */

function directives(policy: string) {
  return new Map(
    policy.split('; ').map((part) => {
      const [name, ...values] = part.split(' ');
      return [name!, values] as const;
    }),
  );
}

const production = directives(
  contentSecurityPolicy({
    nonce: 'abc123',
    dev: false,
    connectOrigins: ['https://api.robis.example', 'wss://ws.robis.example'],
    imageOrigins: ['https://api.robis.example'],
  }),
);

describe('the content security policy', () => {
  test('runs only scripts carrying the nonce, or loaded by one', () => {
    const scripts = production.get('script-src')!;
    expect(scripts).toContain("'nonce-abc123'");
    expect(scripts).toContain("'strict-dynamic'");
    // An injected inline script or handler, or eval, is refused.
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
  });

  test('lets nothing frame the app, embed plugins or move its base', () => {
    expect(production.get('frame-ancestors')).toEqual(["'none'"]);
    expect(production.get('object-src')).toEqual(["'none'"]);
    expect(production.get('base-uri')).toEqual(["'self'"]);
    expect(production.get('form-action')).toEqual(["'self'"]);
  });

  test('talks only to itself, the API and the gateway', () => {
    expect(production.get('connect-src')).toEqual([
      "'self'",
      'https://api.robis.example',
      'wss://ws.robis.example',
    ]);
    expect(production.get('default-src')).toEqual(["'self'"]);
  });

  test('allows eval and the reload socket only in development', () => {
    const dev = directives(
      contentSecurityPolicy({ nonce: 'n', dev: true, connectOrigins: [], imageOrigins: [] }),
    );
    expect(dev.get('script-src')).toContain("'unsafe-eval'");
    expect(dev.get('connect-src')).toContain('ws:');
    expect(production.get('connect-src')).not.toContain('ws:');
  });
});

describe('the fixed headers', () => {
  const header = (production: boolean, key: string) =>
    staticSecurityHeaders(production).find((h) => h.key === key)?.value;

  test('allow the camera for this origin only, and nothing else powerful', () => {
    const policy = header(true, 'Permissions-Policy')!;
    expect(policy).toContain('camera=(self)');
    expect(policy).toContain('microphone=()');
    expect(policy).toContain('geolocation=()');
  });

  test('pin HTTPS in production only', () => {
    // This host only: subdomains are not known to serve HTTPS.
    expect(header(true, 'Strict-Transport-Security')).toMatch(/^max-age=\d{8,}$/);
    expect(header(false, 'Strict-Transport-Security')).toBeUndefined();
  });

  test('refuse sniffing and framing in any environment', () => {
    expect(header(false, 'X-Content-Type-Options')).toBe('nosniff');
    expect(header(false, 'X-Frame-Options')).toBe('DENY');
  });
});

test('an endpoint is reduced to its origin', () => {
  expect(originOf('ws://localhost:4001/ws')).toBe('ws://localhost:4001');
  expect(originOf('https://robis.example/api')).toBe('https://robis.example');
  expect(originOf('/api')).toBeNull();
});
