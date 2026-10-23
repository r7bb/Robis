/**
 * Security headers for the web app (stage 1, item 5).
 *
 * Kept as plain functions with no Next imports, so the middleware, the
 * Next config and the tests all read the same policy.
 */

export type PolicyOptions = {
  /** Fresh per response; only scripts carrying it, or loaded by one, run. */
  nonce: string;
  /** React needs `eval` in development to rebuild server error stacks. */
  dev: boolean;
  /** Where the app fetches from and opens sockets to, besides itself. */
  connectOrigins: readonly string[];
  /** Where pictures come from besides itself: avatars and attachments. */
  imageOrigins: readonly string[];
};

/**
 * A strict policy: scripts by nonce with `strict-dynamic`, so an injected
 * `<script>` or `onclick` does not run, and nothing frames the app.
 *
 * Styles allow inline: the server-rendered HTML carries `style` attributes
 * (72 on the landing, for its motion), and a style cannot
 * run code. The landing's WebGL needs nothing beyond `'self'`: shaders are
 * compiled from strings by the GPU API, which CSP does not govern.
 */
export function contentSecurityPolicy(options: PolicyOptions): string {
  const { nonce, dev, connectOrigins, imageOrigins } = options;
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(dev ? ["'unsafe-eval'"] : []),
    ],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', ...imageOrigins],
    'media-src': ["'self'", 'blob:'],
    'font-src': ["'self'"],
    // Development adds the dev server's own reload socket.
    'connect-src': ["'self'", ...connectOrigins, ...(dev ? ['ws:', 'wss:'] : [])],
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${[...new Set(values)].join(' ')}`)
    .join('; ');
}

/** Two years, the usual long setting; never preloaded from here. */
const HSTS_MAX_AGE_S = 2 * 365 * 24 * 60 * 60;

/**
 * The headers that do not change per response, for every path.
 *
 * The camera is allowed for this origin only (the welcome screen takes a
 * picture); every other powerful feature is off, for the app and for
 * anything it embeds. HSTS only in production: over plain HTTP in
 * development a browser ignores it anyway, and it should not be pinned to
 * localhost by accident. This host only, without `includeSubDomains`:
 * nothing here knows that every subdomain of the deployed domain serves
 * HTTPS, and a wrong guess locks browsers out of one for the whole max-age.
 */
export function staticSecurityHeaders(production: boolean): { key: string; value: string }[] {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    // For browsers too old for frame-ancestors.
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value:
        'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), display-capture=(), browsing-topics=()',
    },
    ...(production
      ? [
          {
            key: 'Strict-Transport-Security',
            value: `max-age=${HSTS_MAX_AGE_S}`,
          },
        ]
      : []),
  ];
}

/** The origin of a URL, or null if it is not one. `ws:` stays `ws:`. */
export function originOf(url: string): string | null {
  try {
    const { protocol, host } = new URL(url);
    return host ? `${protocol}//${host}` : null;
  } catch {
    return null;
  }
}
