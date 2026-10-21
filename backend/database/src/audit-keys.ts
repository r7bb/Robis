import { createHash } from 'node:crypto';

/**
 * The keys the audit chain is signed with.
 *
 * An unkeyed hash chain stops casual edits, but anyone with write access to
 * the database can recompute every hash after changing a row. With an HMAC
 * the hash needs a key the database never holds, so a consistent rewrite
 * needs the key as well as the data.
 *
 * Several keys can be configured at once, so a key can be rotated: new events
 * are signed with the current one, and each event records the id of the key
 * that signed it, so older events still verify with the key they were made
 * with. Retire a key only once no event that needs it is kept.
 *
 *   AUDIT_HMAC_KEYS=2026b:<base64 secret>,2026a:<base64 secret>
 *
 * The first is current unless AUDIT_HMAC_KEY_ID names another. A secret is
 * at least 32 bytes; `openssl rand -base64 32` makes one.
 */

export type AuditKeyring = {
  currentId: string;
  keys: ReadonlyMap<string, Buffer>;
};

export type AuditKeyEnv = {
  NODE_ENV?: string;
  AUDIT_HMAC_KEYS?: string;
  AUDIT_HMAC_KEY_ID?: string;
};

/** What a key id may look like; anything else in a row is an edit. */
export const AUDIT_KEY_ID = /^[a-z0-9-]{1,32}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MIN_SECRET_BYTES = 32;

/** Development and tests only, and refused anywhere else by id. */
export const DEVELOPMENT_KEY_ID = 'dev';
/**
 * Ids whose secrets are committed to this repository (development, and the
 * throwaway container stack), so they sign nothing anyone should trust.
 */
const PUBLIC_KEY_IDS = new Set([DEVELOPMENT_KEY_ID, 'stack']);
const DEVELOPMENT_SECRET = createHash('sha256').update('robis-development-audit-key').digest();

function parseKeys(raw: string): Map<string, Buffer> {
  const keys = new Map<string, Buffer>();
  const entries = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  for (const entry of entries) {
    const colon = entry.indexOf(':');
    const id = colon > 0 ? entry.slice(0, colon) : '';
    if (!AUDIT_KEY_ID.test(id)) {
      throw new Error(
        'AUDIT_HMAC_KEYS: each entry is <id>:<base64 secret>, id a-z 0-9 and dashes.',
      );
    }
    const encoded = entry.slice(colon + 1);
    // Strict: Node's decoder skips characters it does not know, so a typo
    // would quietly become a different key.
    const secret = Buffer.from(encoded, 'base64');
    if (!BASE64.test(encoded) || secret.toString('base64') !== encoded) {
      throw new Error(`AUDIT_HMAC_KEYS: the secret for "${id}" is not valid base64.`);
    }
    if (secret.every((byte) => byte === secret[0])) {
      throw new Error(`AUDIT_HMAC_KEYS: the secret for "${id}" is one byte repeated, not random.`);
    }
    if (secret.length < MIN_SECRET_BYTES) {
      throw new Error(
        `AUDIT_HMAC_KEYS: the secret for "${id}" is under ${MIN_SECRET_BYTES} bytes.`,
      );
    }
    if (keys.has(id)) throw new Error(`AUDIT_HMAC_KEYS: "${id}" appears twice.`);
    keys.set(id, secret);
  }
  return keys;
}

export function auditKeyringFromEnv(env: AuditKeyEnv): AuditKeyring {
  // Only a stated development or test environment is local; unset is not.
  const local = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  const raw = env.AUDIT_HMAC_KEYS?.trim();

  if (!raw) {
    if (!local) {
      throw new Error(
        'Refusing to start: AUDIT_HMAC_KEYS is not set. The audit trail is signed with a key held outside the database; see backend/database/src/audit-keys.ts.',
      );
    }
    return {
      currentId: DEVELOPMENT_KEY_ID,
      keys: new Map([[DEVELOPMENT_KEY_ID, DEVELOPMENT_SECRET]]),
    };
  }

  const keys = parseKeys(raw);
  const published = [...keys.keys()].find((id) => PUBLIC_KEY_IDS.has(id));
  if (!local && published) {
    throw new Error(`AUDIT_HMAC_KEYS: the id "${published}" is for development only.`);
  }
  const currentId = env.AUDIT_HMAC_KEY_ID?.trim() || [...keys.keys()][0]!;
  if (!keys.has(currentId)) {
    throw new Error(`AUDIT_HMAC_KEY_ID names "${currentId}", which AUDIT_HMAC_KEYS does not hold.`);
  }
  return { currentId, keys };
}

let configured: AuditKeyring | null = null;

/** Set the keyring explicitly (at startup, or in a test). */
export function configureAuditKeys(keyring: AuditKeyring) {
  configured = keyring;
}

/** The configured keyring, read from the environment on first use otherwise. */
export function auditKeyring(): AuditKeyring {
  configured ??= auditKeyringFromEnv(process.env);
  return configured;
}
