/**
 * Which address overrides a production build must refuse. The web image
 * uses relative addresses so it runs anywhere; an override is accepted only
 * as an https or wss address on a public name. Anything else (plain http,
 * localhost or another spelling of this machine, a bare `host:port`) would
 * work on the build machine and nowhere else, or leak cookies in the clear,
 * so `next.config.ts` refuses the build.
 */
const OVERRIDES = ['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_REALTIME_URL'] as const;
const SECURE = new Set(['https:', 'wss:']);

function isLocalName(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    host === '' ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === 'host.docker.internal' ||
    host === '0.0.0.0' ||
    // Every IPv4 loopback spelling URL normalises to, and IPv6 loopback forms.
    host.startsWith('127.') ||
    host === '::1' ||
    // IPv4-mapped loopback, as URL normalises it (::ffff:7f00:1).
    host.startsWith('::ffff:7f') ||
    host.includes('127.0.0.1')
  );
}

export function localEndpoints(env: Readonly<Record<string, string | undefined>>): string[] {
  return OVERRIDES.filter((name) => {
    const value = env[name]?.trim();
    if (!value) return false;
    try {
      const url = new URL(value);
      return !SECURE.has(url.protocol) || isLocalName(url.hostname);
    } catch {
      // Relative (no scheme) is the default shape; anything else is refused.
      return !value.startsWith('/');
    }
  });
}
