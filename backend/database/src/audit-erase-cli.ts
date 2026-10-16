/**
 * `bun run audit:erase -- <user id> [--confirm]`: erase one person's
 * personal fields from the audit trail, and the usernames they used to have. DRAFT FOR LEGAL REVIEW: see
 * `audit-redaction.ts` for what it does and what it does not claim.
 *
 * Without `--confirm` it only counts what it would change. The chain still
 * verifies afterwards; the events stay, naming nobody.
 */
import { countAuditPersonalData, eraseAuditPersonalData } from './audit-redaction.ts';
import { createDatabase } from './index.ts';
import { eraseUsernameHistory } from './usernames.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const [subjectId, flag] = process.argv.slice(2);
if (!subjectId || !UUID.test(subjectId)) {
  console.error('usage: bun run audit:erase -- <user id> [--confirm]');
  process.exit(2);
}

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://robis:robis@localhost:5433/robis';
const { db, close } = createDatabase(DATABASE_URL, { max: 1 });

try {
  if (flag === '--confirm') {
    const erased = await eraseAuditPersonalData(db, subjectId);
    console.log(`Erased personal fields from ${erased} audit event(s).`);
    // Old usernames are personal too; their holds stay, naming nobody.
    const names = await eraseUsernameHistory(db, subjectId);
    console.log(`Forgot ${names} former username(s); their holds still run.`);
  } else {
    const count = await countAuditPersonalData(db, subjectId);
    console.log(`${count} audit event(s) hold personal fields for ${subjectId}.`);
    console.log('Nothing changed. Run again with --confirm to erase them.');
  }
} finally {
  await close();
}
