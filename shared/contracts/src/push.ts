/**
 * Where a web push may be sent (C3). A push subscription's endpoint comes
 * from the browser, so from the client: the server must not POST to any
 * address it is handed, or a subscription would be a way to make it call
 * an internal service. Only the browsers' own push services are allowed,
 * over https on the default port.
 */
const PUSH_HOSTS: readonly string[] = [
  // Chrome, Edge (on Chromium), Opera, Samsung Internet.
  'fcm.googleapis.com',
  // Firefox.
  'updates.push.services.mozilla.com',
];

/** Services whose hosts are subdomains of these (Safari's, Windows'). */
const PUSH_HOST_SUFFIXES: readonly string[] = ['.push.apple.com', '.notify.windows.com'];

/**
 * Devices one account keeps (C3): a phone, a laptop, a few browsers. Past
 * this the oldest drops off, so no account can pile up endpoints for the
 * worker to call on its behalf.
 */
export const PUSH_DEVICES_PER_USER = 10;

/** The longest endpoint taken: real ones are a few hundred characters. */
export const PUSH_ENDPOINT_MAX = 1000;

export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > PUSH_ENDPOINT_MAX) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}
