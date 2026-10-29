/**
 * Where the API and the realtime gateway live: on the web app's own origin,
 * behind the edge proxy (`deploy/Caddyfile`): the API at `/api`, the
 * gateway at `/ws`. Relative, so one built web image runs at any address.
 *
 * Development can point elsewhere with `NEXT_PUBLIC_API_URL` and
 * `NEXT_PUBLIC_REALTIME_URL` (`bun run dev:web` sets the gateway's; the API
 * is reached through a rewrite in `next.config.ts`). A production build
 * refuses either one naming localhost.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

/** The gateway's WebSocket address, worked out in the browser when relative. */
export function realtimeUrl(): string {
  const configured = process.env.NEXT_PUBLIC_REALTIME_URL;
  if (configured) return configured;
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}/ws`;
}
