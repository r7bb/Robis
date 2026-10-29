/**
 * `bun run audit:erase -- <user id> [--confirm]`: erase one person's
 * (or `-- --pending`: carry out every erasure a deleted account asked for)
 * personal fields from the audit trail, and the usernames they used to
 * have. DRAFT FOR LEGAL REVIEW: see `audit-redaction.ts` for what it does
 * and what it does not claim.
 *
 * It runs as its own role, `robis_eraser` (`ERASER_DATABASE_URL`), the only
 * one that may (stage 1, item 9); in production nothing else will do. Each
 * erasure is recorded as counts and a commitment, never the person: it
 * prints the nonce that, with the user id, proves which erasure this was.
 * Keep it with the request.
 *
 * Without `--confirm` it only counts what it would change. The chain still
 * verifies afterwards; the events stay, naming nobody.
 */
import { loadConfig } from '@robis/shared/config';
import { countAuditPersonalData } from './audit-redaction.ts';
import { eraseSubject, processErasureRequests } from './erasure.ts';
import { createDatabase } from './index.ts';

// Before anything else, and failing closed: see `loadConfig`.
const { databaseUrl: DATABASE_URL, nodeEnv } = loadConfig();

// The eraser's own connection; locally the database address will do.
const ERASER_URL =
  process.env.ERASER_DATABASE_URL?.trim() || (nodeEnv === 'production' ? '' : DATABASE_URL);
if (!ERASER_URL) {
  console.error(
    'ERASER_DATABASE_URL is required in production: audit:erase runs as robis_eraser, the only role that may erase.',
  );
  process.exit(2);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const [subjectId, flag] = process.argv.slice(2);

// The erasures deleted accounts asked for (stage 1, item 10): each is
// recorded as usual, and marked done.
if (subjectId === '--pending') {
  const pending = createDatabase(ERASER_URL, { max: 1 });
  try {
    const done = await processErasureRequests(pending.db);
    console.log(`Carried out ${done} requested erasure(s).`);
  } finally {
    await pending.close();
  }
  process.exit(0);
}
if (!subjectId || !UUID.test(subjectId)) {
  console.error('usage: bun run audit:erase -- <user id> [--confirm]');
  process.exit(2);
}

const { db, close } = createDatabase(ERASER_URL, { max: 1 });

try {
  if (flag === '--confirm') {
    const erased = await eraseSubject(db, subjectId);
    console.log(`Erased personal fields from ${erased.auditEventsErased} audit event(s).`);
    // Old usernames are personal too; their holds stay, naming nobody.
    console.log(`Forgot ${erased.usernamesForgotten} former username(s); their holds still run.`);
    console.log(`Recorded as commitment ${erased.commitment}.`);
    console.log(`Nonce, to keep with the request and nowhere else: ${erased.nonce}`);
  } else {
    const count = await countAuditPersonalData(db, subjectId);
    console.log(`${count} audit event(s) hold personal fields for ${subjectId}.`);
    console.log('Nothing changed. Run again with --confirm to erase them.');
  }
} finally {
  await close();
}
