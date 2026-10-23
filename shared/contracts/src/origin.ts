/**
 * `WEB_ORIGIN` as a browser would send it in an `Origin` header.
 *
 * The API and the realtime gateway compare `Origin` against it exactly, and
 * a browser sends a lowercase scheme and host with no trailing slash. Left
 * as typed, `https://Robis.example/` would refuse every write the web app
 * makes. So it is normalised once at startup, and anything that is not a
 * bare origin (a path, a query, not a URL at all) refuses to start.
 */
export function webOriginOf(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // The value is not repeated: whatever it is, it may hold a secret.
    throw new Error('WEB_ORIGIN must be an origin like https://robis.example.');
  }
  if (url.username || url.password) {
    throw new Error('WEB_ORIGIN must not contain a user name or password.');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(
      `WEB_ORIGIN must be a bare origin, with no path or query; got "${url.origin}/…".`,
    );
  }
  return url.origin;
}
