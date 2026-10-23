/**
 * `bun run audit:seal`: sign the audit chains written before signing, once,
 * when upgrading. See `audit-seal.ts` for why this is never automatic.
 *
 * Needs the same AUDIT_HMAC_KEYS as the API, and a database connection that
 * may insert audit events (the runtime role is enough). Exits non-zero if any
 * workspace could not be sealed.
 */
import { loadConfig } from '@robis/shared/config';
import { auditKeyringFromEnv, configureAuditKeys } from './audit-keys.ts';
import { sealLegacyChains } from './audit-seal.ts';
import { createDatabase } from './index.ts';

// Before anything else, and failing closed: see `loadConfig`.
const { databaseUrl: DATABASE_URL } = loadConfig();

configureAuditKeys(auditKeyringFromEnv(process.env));
const { db, close } = createDatabase(DATABASE_URL, { max: 1 });

try {
  const outcomes = await sealLegacyChains(db);
  for (const result of outcomes) {
    const note =
      result.outcome === 'sealed'
        ? ''
        : result.outcome === 'skipped'
          ? ` (${result.reason})`
          : ` (${result.error})`;
    console.log(`${result.workspaceId}: ${result.outcome}${note}`);
  }
  const sealed = outcomes.filter((result) => result.outcome === 'sealed').length;
  console.log(`Sealed ${sealed} of ${outcomes.length} unsigned chain(s).`);
  if (outcomes.some((result) => result.outcome === 'failed')) process.exitCode = 1;
} finally {
  await close();
}
