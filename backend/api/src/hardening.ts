import { randomUUID } from 'node:crypto';

/**
 * Two small pieces of request hygiene, kept apart from `app.ts` so they can
 * be tested on their own.
 */

/** Fastify's own shape for a trust decision, one hop at a time. */
type TrustFunction = (address: string, hop: number) => boolean;

/**
 * What Fastify's `trustProxy` should be, from `TRUST_PROXY`.
 *
 * It was hard-coded to `true`, which trusts every `X-Forwarded-For` from
 * anyone. The rate limiter keys on the client address, so a client could
 * walk past every per-address limit by sending a different header each
 * time. The default is now to trust nothing, which is right when the API
 * faces clients directly; a deployment behind a proxy says how many hops,
 * or which addresses, it trusts.
 *
 * `true` is refused rather than accepted, because it is the setting that
 * caused the problem and there is no deployment it is the right answer for.
 */
export function trustProxySetting(
  raw: string | undefined,
): boolean | string | string[] | TrustFunction {
  const value = (raw ?? '').trim();
  if (value === '' || value === 'false' || value === '0') return false;

  if (value === 'true') {
    throw new Error(
      'TRUST_PROXY=true would trust any client to name its own address. ' +
        'Set the number of trusted hops (e.g. 1) or the proxy addresses instead.',
    );
  }

  // A hop count, as a function because that is how Fastify's types take it:
  // trust the nearest `hops` proxies and stop.
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    return (_address, hop) => hop < hops;
  }

  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length === 1 ? (parts[0] ?? false) : parts;
}

/**
 * Ids short enough to log and plain enough to be safe in a header or a log
 * line: no spaces, no markup, and no newline that could forge a second log
 * entry.
 */
const WELL_FORMED_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * The id a request is handled and logged under.
 *
 * An incoming `x-request-id` is kept when it is well formed, so a trace
 * started by a proxy or a client carries across into the API's logs and on
 * to the ML service. Anything else is replaced with a fresh UUID rather
 * than echoed, because an id copied into logs and response headers is
 * attacker-controlled text.
 */
export function requestIdFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value && WELL_FORMED_ID.test(value) ? value : randomUUID();
}
