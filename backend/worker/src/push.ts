import {
  channelsFor,
  type Executor,
  heldByTwoFactor,
  notifications,
  PUSH_NOTIFICATION_JOB,
  type PushJob,
  pushSubscriptions,
} from '@robis/database';
import { isAllowedPushEndpoint, type NotificationKind } from '@robis/shared';
import { log } from '@robis/telemetry/log';
import { eq } from 'drizzle-orm';
import type { Handlers } from './runner.ts';

/**
 * Web push (C3), with no library.
 *
 * A push here carries nothing: no title, no text, no ids. The browser shows
 * a fixed "something new" prompt and the app says what when it is opened,
 * the same ids-only rule the realtime events follow. With no payload there
 * is nothing to encrypt, which is all a push library would be for; what is
 * left is a VAPID signature (RFC 8292), an ES256 token made with WebCrypto.
 * (The common `web-push` package is MPL 2.0; this needs none of it.)
 */

export type VapidKeys = {
  /** The uncompressed P-256 point, base64url: what browsers subscribe with. */
  publicKey: string;
  /** The private scalar `d`, base64url. A secret: from the environment only. */
  privateKey: string;
};

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(bytes as ArrayBuffer).toString('base64url');
const fromB64url = (text: string) => Buffer.from(text, 'base64url');

/** A new key pair, for `bun run push:keys` and the tests. */
export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  if (!jwk.d) throw new Error('the generated key has no private part');
  return { publicKey: b64url(raw), privateKey: jwk.d };
}

/** Imported once per pair, not once per push. */
const imported = new WeakMap<VapidKeys, Promise<CryptoKey>>();

/** The signing key, rebuilt from the two halves the environment holds. */
function signingKey(keys: VapidKeys): Promise<CryptoKey> {
  const cached = imported.get(keys);
  if (cached) return cached;
  const made = importSigningKey(keys);
  imported.set(keys, made);
  // A failed import is not kept, so the next use tries again.
  made.catch(() => imported.delete(keys));
  return made;
}

async function importSigningKey(keys: VapidKeys): Promise<CryptoKey> {
  const point = fromB64url(keys.publicKey);
  if (point.length !== 65 || point[0] !== 4)
    throw new Error('VAPID_PUBLIC_KEY is not a P-256 point');
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: b64url(point.subarray(1, 33)),
      y: b64url(point.subarray(33, 65)),
      d: keys.privateKey,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

/** How long a signature is good for: under the 24 hours the services accept. */
const TOKEN_SECONDS = 12 * 60 * 60;

/** The `Authorization` header for one push service (RFC 8292). */
export async function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  now = new Date(),
): Promise<string> {
  const encode = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));
  const head = encode({ typ: 'JWT', alg: 'ES256' });
  const body = encode({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now.getTime() / 1000) + TOKEN_SECONDS,
    sub: subject,
  });
  // WebCrypto signs ECDSA as r || s, the form a JWS wants.
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    await signingKey(keys),
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `vapid t=${head}.${body}.${b64url(signature)}, k=${keys.publicKey}`;
}

/** How long a push is kept for a device that is off: a day, then it is stale. */
const PUSH_TTL_SECONDS = 24 * 60 * 60;
/** How long one push service gets to answer. */
const PUSH_TIMEOUT_MS = 10_000;

/**
 * What became of one push:
 * - `sent`;
 * - `gone`: the subscription has expired, was withdrawn, or is malformed
 *   (404, 410, 400, 413), so it will never work and is dropped;
 * - `refused`: the service will not take our signature (401, 403), which
 *   is the server's keys at fault, not the device, so it is kept and not
 *   retried, and the log says so;
 * - anything else (429, 5xx, no answer) throws, to be tried again.
 */
type Outcome = 'sent' | 'gone' | 'refused';
const GONE = new Set([400, 404, 410, 413]);
const REFUSED = new Set([401, 403]);

/** A failure worth another try, named by its status alone, never by the device. */
class PushRetry extends Error {}

async function pushTo(
  endpoint: string,
  deps: { keys: VapidKeys; subject: string; fetcher: typeof fetch },
): Promise<Outcome> {
  // Checked again here, not only when subscribing: the row is the only
  // thing between this request and wherever it says to send it.
  if (!isAllowedPushEndpoint(endpoint)) return 'gone';
  let response: Response;
  try {
    response = await deps.fetcher(endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthorization(endpoint, deps.keys, deps.subject),
        TTL: String(PUSH_TTL_SECONDS),
        Urgency: 'normal',
        // One waiting ping per device: a phone that was off hears once, not
        // once per notification.
        Topic: 'robis',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
  } catch (error) {
    // The message of a network error can carry the URL, which is the
    // device's secret: only the kind of failure is passed on.
    throw new PushRetry(`push service did not answer (${(error as Error).name})`);
  }
  await response.body?.cancel();
  if (response.ok) return 'sent';
  if (GONE.has(response.status)) return 'gone';
  if (REFUSED.has(response.status)) return 'refused';
  throw new PushRetry(`push service answered ${response.status}`);
}

/**
 * Push to each device: a gone one is removed, a refusal of our signature is
 * logged, and the failures worth another try are returned, by status only.
 */
async function pushToDevices(
  db: Executor,
  devices: readonly { id: string; endpoint: string }[],
  send: { keys: VapidKeys; subject: string; fetcher: typeof fetch },
): Promise<string[]> {
  const retry: string[] = [];
  for (const device of devices) {
    try {
      const outcome = await pushTo(device.endpoint, send);
      if (outcome === 'gone') {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, device.id));
      } else if (outcome === 'refused') {
        log.warn('push refused our signature: check the VAPID keys match');
      }
    } catch (error) {
      if (!(error instanceof PushRetry)) throw error;
      retry.push(error.message);
    }
  }
  return retry;
}

export function pushHandlers(deps: {
  keys: VapidKeys;
  subject: string;
  fetcher?: typeof fetch;
}): Handlers {
  const send = { keys: deps.keys, subject: deps.subject, fetcher: deps.fetcher ?? fetch };

  return {
    [PUSH_NOTIFICATION_JOB]: async (payload, { db }: { db: Executor }) => {
      const { notificationId } = payload as PushJob;
      const [row] = await db
        .select({
          userId: notifications.userId,
          workspaceId: notifications.workspaceId,
          kind: notifications.kind,
          pushedAt: notifications.pushedAt,
        })
        .from(notifications)
        .where(eq(notifications.id, notificationId));
      // Dismissed, or pushed already (a retry after it went): nothing to do.
      if (!row || row.pushedAt) return;
      // Push turned off for this kind since it was made: stop here too.
      const channels = await channelsFor(db, [row.userId], row.kind as NotificationKind);
      if (!channels.get(row.userId)?.push) return;
      // Nor from a workspace that requires two-factor while they have none (C4).
      if (await heldByTwoFactor(db, row.userId, row.workspaceId)) return;

      const devices = await db
        .select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, row.userId));
      const retry = await pushToDevices(db, devices, send);
      // Retried whole: a device already pinged may hear twice, and the
      // Topic header folds a waiting second ping into the first.
      if (retry.length > 0)
        throw new Error(`push failed for ${retry.length} device(s): ${retry[0]}`);
      await db
        .update(notifications)
        .set({ pushedAt: new Date() })
        .where(eq(notifications.id, notificationId));
    },
  };
}

/**
 * Check, at start-up, that the two halves belong to one pair: a private key
 * that does not match its public half imports fine and then has every push
 * refused, which would otherwise surface only as warnings.
 */
export async function checkVapidKeys(keys: VapidKeys): Promise<void> {
  const message = new TextEncoder().encode('robis vapid check');
  const mismatch = () =>
    new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY do not belong together.');
  // WebCrypto may refuse the halves of two pairs on import, or take them and
  // sign with a key the public half cannot verify; both are the same mistake.
  const key = await signingKey(keys).catch(() => {
    throw mismatch();
  });
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, message);
  const publicKey = await crypto.subtle.importKey(
    'raw',
    fromB64url(keys.publicKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    signature,
    message,
  );
  if (!ok) throw mismatch();
}

/** The push keys from the environment, or null when push is not set up. */
export function vapidFromEnv(env: NodeJS.ProcessEnv): { keys: VapidKeys; subject: string } | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey && !privateKey) return null;
  if (!publicKey || !privateKey || !subject) {
    throw new Error(
      'Web push needs VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT together.',
    );
  }
  if (!/^(mailto:|https:\/\/)/.test(subject)) {
    throw new Error('VAPID_SUBJECT must be a mailto: or https: address.');
  }
  return { keys: { publicKey, privateKey }, subject };
}
