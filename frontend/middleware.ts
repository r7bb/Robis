import { type NextRequest, NextResponse } from 'next/server';
import { API_URL } from './lib/endpoints.ts';
import { contentSecurityPolicy, originOf } from './lib/security-headers.ts';

const API_ORIGIN = originOf(API_URL);
// Relative addresses are the app's own origin, which 'self' already covers
// (WebSockets included); only an override elsewhere needs naming.
const REALTIME_ORIGIN = originOf(process.env.NEXT_PUBLIC_REALTIME_URL ?? '');

/**
 * A fresh nonce on every page, in the Content-Security-Policy of both the
 * request (Next reads it there and stamps its own scripts with it) and the
 * response (where the browser enforces it). The other security headers do
 * not change per response and are set in `next.config.ts`.
 */
export function middleware(request: NextRequest) {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const policy = contentSecurityPolicy({
    nonce,
    dev: process.env.NODE_ENV === 'development',
    connectOrigins: [API_ORIGIN, REALTIME_ORIGIN].filter((o): o is string => o !== null),
    imageOrigins: API_ORIGIN ? [API_ORIGIN] : [],
  });

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  // Pages only: built assets carry no scripts of their own to stamp, and a
  // prefetch is answered from the page it prefetches.
  matcher: [
    {
      source:
        '/((?!_next/static|_next/image|favicon.ico|sw.js|.*\\.(?:png|svg|jpg|webp|ico|txt|xml|webmanifest)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
