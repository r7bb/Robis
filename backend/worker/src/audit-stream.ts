import {
  advanceStreamCursor,
  type Database,
  type ExportedAuditEvent,
  listAuditEvents,
  toExported,
  workspacesBehindStream,
} from '@robis/database';

/**
 * The SIEM stream: the audit trail, delivered to a receiver over HTTPS.
 *
 * At-least-once, by construction. Each workspace has a cursor, advanced only
 * after the receiver answers 2xx for a batch. A crash, a timeout or a lost
 * response between "receiver stored it" and "cursor moved" sends the same
 * batch again on the next run. Every event carries a stable `key` (its id),
 * so the receiver drops what it has already seen and ends up with each event
 * exactly once. That is the contract a SIEM ingest endpoint expects.
 *
 * Configured by the operator, not by workspace admins: the destination is
 * deployment configuration, so no user can point the server at an address
 * of their choosing.
 */

export type AuditSink = { send: (events: ExportedAuditEvent[]) => Promise<void> };

export type AuditStreamConfig = { url: URL; token: string | null; intervalMs: number };

/** Events per request. Small enough for any ingest limit, large enough to keep up. */
export const STREAM_BATCH_SIZE = 100;

const DEFAULT_INTERVAL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;

/** Plain HTTP is allowed only to this machine, for a local collector. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Read the stream's configuration, or null when no receiver is set.
 *
 * Throws on a bad value rather than ignoring it, so a typo in deployment
 * stops the worker at boot instead of silently streaming nowhere.
 */
export function auditStreamConfig(
  env: Record<string, string | undefined>,
): AuditStreamConfig | null {
  const raw = env.AUDIT_STREAM_URL?.trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('AUDIT_STREAM_URL is not a valid URL');
  }

  const secure = url.protocol === 'https:';
  const local = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  if (!secure && !local) {
    throw new Error('AUDIT_STREAM_URL must use https (plain http only to localhost)');
  }
  if (url.username || url.password) {
    throw new Error('AUDIT_STREAM_URL must not carry credentials; use AUDIT_STREAM_TOKEN');
  }

  const intervalMs = Number(env.AUDIT_STREAM_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  if (!Number.isInteger(intervalMs) || intervalMs < 1000) {
    throw new Error('AUDIT_STREAM_INTERVAL_MS must be a whole number of at least 1000');
  }

  const token = env.AUDIT_STREAM_TOKEN?.trim() || null;
  // A token that cannot go in a header would only fail at the first send.
  if (token && !/^[\x21-\x7e]+$/.test(token)) {
    throw new Error('AUDIT_STREAM_TOKEN must be printable ASCII with no spaces');
  }

  return { url, token, intervalMs };
}

/**
 * POST batches as JSON: `{ source: "robis", events: [...] }`.
 *
 * Redirects are refused rather than followed, so the bearer token is only
 * ever sent to the configured host. The error carries the status, never the
 * response body, which a misbehaving receiver could fill with anything.
 */
export function httpSink(config: AuditStreamConfig, fetchImpl: typeof fetch = fetch): AuditSink {
  return {
    async send(events) {
      const response = await fetchImpl(config.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'robis-audit-stream',
          ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
        },
        body: JSON.stringify({ source: 'robis', events }),
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      // Nothing is read from the answer, so release it rather than leave the
      // connection waiting on a body nobody will consume.
      await response.body?.cancel();

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`audit stream receiver answered ${response.status}`);
      }
    },
  };
}

/** Ship one workspace from its cursor to the end, batch by batch. */
async function streamWorkspace(
  db: Database,
  sink: AuditSink,
  workspaceId: string,
  from: number,
  batchSize: number,
): Promise<number> {
  let after = from;
  let delivered = 0;

  for (;;) {
    const { rows } = await listAuditEvents(db, workspaceId, { after, limit: batchSize });
    if (rows.length === 0) return delivered;

    await sink.send(rows.map(toExported));

    after = rows.at(-1)!.seq;
    await advanceStreamCursor(db, workspaceId, after);
    delivered += rows.length;

    if (rows.length < batchSize) return delivered;
  }
}

/**
 * Deliver everything not yet acknowledged, workspace by workspace.
 *
 * A failure in one workspace does not stop the others: a receiver that
 * rejects one tenant's batch must not hold every other tenant's events
 * hostage. Once every workspace has had its turn, any failure is rethrown,
 * so the job queue retries with backoff and the next run resumes each
 * workspace at its first unacknowledged event.
 */
export async function streamAuditEvents(
  db: Database,
  sink: AuditSink,
  batchSize = STREAM_BATCH_SIZE,
): Promise<{ delivered: number }> {
  let delivered = 0;
  const failures: string[] = [];

  for (const { workspaceId, deliveredSeq } of await workspacesBehindStream(db)) {
    try {
      delivered += await streamWorkspace(db, sink, workspaceId, deliveredSeq, batchSize);
    } catch (error) {
      failures.push(`${workspaceId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `audit stream: ${failures.length} workspace(s) not delivered (${delivered} events were): ${failures.join('; ')}`,
    );
  }

  return { delivered };
}
