import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { localEndpoints } from './lib/build-guard.ts';
import { staticSecurityHeaders } from './lib/security-headers.ts';

const production = process.env.NODE_ENV === 'production';

/*
 * One web image for every address: it uses /api and /ws on its own origin
 * (see lib/endpoints.ts). A production build that bakes in localhost would
 * work on the build machine only, so it is refused here, at build time.
 */
const local = production ? localEndpoints(process.env) : [];
if (local.length > 0) {
  throw new Error(
    `Refusing a production build that points at this machine: ${local.join(', ')}. ` +
      "Leave them unset to use /api and /ws on the app's own origin.",
  );
}

/** The API in development, which the edge proxy stands in for elsewhere. */
const DEV_API = process.env.DEV_API_ORIGIN ?? 'http://localhost:4000';

/** Pages whose URL carries a single-use token. */
const TOKEN_PAGES = ['/reset-password', '/verify-email', '/signup'];

const config: NextConfig = {
  /*
   * Dev and production builds write to different directories.
   *
   * They shared `.next` by default, so running `bun --filter '@robis/web'
   * build` while the dev server was up replaced the chunks that server had
   * already loaded. The next request died with `Cannot find module
   * './539.js'` from `webpack-runtime.js`, which reads like a corrupted
   * install and is really just two processes writing to one directory.
   *
   * `bun run dev:web` sets `NEXT_DIST_DIR=.next-dev`, so a build can run at
   * any time without touching what dev is serving.
   */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  /*
   * The container image sets `NEXT_OUTPUT=standalone`: a self-contained
   * server with only the files it imports, traced from the repository root
   * because Bun hoists the workspace's packages there. Local builds and
   * `next start` are unchanged.
   */
  ...(process.env.NEXT_OUTPUT === 'standalone'
    ? {
        output: 'standalone' as const,
        outputFileTracingRoot: fileURLToPath(new URL('..', import.meta.url)),
      }
    : {}),
  reactStrictMode: true,
  /*
   * Images are served as they are: the landing's screenshots are committed
   * as WebP at their display size (stage 4, item 34), so Next never loads an
   * image library and the web image carries none.
   */
  images: { unoptimized: true },
  // The workspace packages ship TypeScript source rather than build output, so
  // Next has to compile them alongside the app.
  transpilePackages: ['@robis/shared'],
  /*
   * The dev-mode build indicator is a floating badge in the bottom-left
   * corner. It is useful while developing and it also lands in the middle of
   * every screenshot the capture script takes against the dev server, where
   * it reads as a rendering bug rather than as tooling.
   */
  devIndicators: false,
  /*
   * Every response gets the fixed security headers (the per-page
   * Content-Security-Policy comes from `middleware.ts`).
   *
   * The reset, verification and sign-up pages carry a single-use token in
   * the URL. `no-referrer` stops a link clicked on the page from handing
   * that URL, token and all, to whatever site it leads to; `no-store` stops
   * a shared or browser cache keeping a copy of a page whose whole point is
   * that it works once.
   */
  /*
   * In development there is no edge proxy, so /api is forwarded to the API
   * here. The gateway is reached directly (`bun run dev:web` sets its
   * address), since a rewrite does not carry a WebSocket.
   */
  async rewrites() {
    return production ? [] : [{ source: '/api/:path*', destination: `${DEV_API}/:path*` }];
  },

  async headers() {
    const tokenPage = [
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'Cache-Control', value: 'no-store' },
    ];
    // The bare path and anything under it, so a future sub-route keeps the
    // same protection. Query strings are covered either way. Listed after
    // the site-wide rule, so their Referrer-Policy is the one that wins.
    return [
      {
        source: '/:path*',
        headers: staticSecurityHeaders(process.env.NODE_ENV === 'production'),
      },
      ...TOKEN_PAGES.flatMap((path) => [
        { source: path, headers: tokenPage },
        { source: `${path}/:path*`, headers: tokenPage },
      ]),
    ];
  },
};

export default config;
