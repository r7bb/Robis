import { createHash, randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Executor } from './index.ts';
import { auditEvents } from './schema.ts';

/**
 * Erasing a person from the audit trail without breaking it.
 *
 * DRAFT FOR LEGAL REVIEW. This is a technical design for handling a request
 * to erase someone's personal data from the trail. It makes no claim that it
 * satisfies any law or regulation; whether it does, and when it must be
 * used, is for a lawyer to say.
 *
 * The problem: the trail is a hash chain, so deleting or editing anything an
 * event's hash covers breaks verification from that event on. The design:
 * personal fields about someone (a username, today) are not put in the
 * hashed payload at all. They are stored beside it, with a random salt and
 * the id of the person they are about, and the hash covers only a
 * commitment: SHA-256 of the salt and the fields. Erasure sets the fields,
 * the salt and the subject to null and keeps the commitment, so the chain
 * still verifies. With the salt gone, the commitment cannot be used to test
 * a guess at what the fields said.
 *
 * Applies to events written from now on. Older events carry usernames inside
 * the hashed payload, as written, and erasing those would break the chain;
 * that is stated in docs/PLATFORM_PLAN.md rather than hidden.
 */

export type PersonalFields = { subjectId: string; fields: Record<string, unknown> };

const SALT_BYTES = 16;

/**
 * SHA-256 of the salt, whose fields they are, and the fields. The subject is
 * bound in, so a row re-pointed at someone else no longer matches, and an
 * erasure for one person cannot be steered onto another's events.
 */
export function personalCommitment(salt: string, subjectId: string, personalJson: string): string {
  return createHash('sha256')
    .update(`${salt}\x1f${subjectId}\x1f${personalJson}`, 'utf8')
    .digest('hex');
}

/** What to store for a new event's personal fields. */
export function commitPersonal(personal: PersonalFields) {
  const json = JSON.stringify(personal.fields);
  const salt = randomBytes(SALT_BYTES).toString('hex');
  const subjectId = personal.subjectId.toLowerCase();
  return {
    personal: json,
    personalSalt: salt,
    personalSubjectId: subjectId,
    personalCommitment: personalCommitment(salt, subjectId, json),
  };
}

/**
 * Whether a row's personal fields agree with its commitment. Erased (all
 * three null) is fine; some without the others, or a mismatch, is an edit.
 */
export function personalHolds(row: {
  personal: string | null;
  personalSalt: string | null;
  personalSubjectId: string | null;
  personalCommitment: string | null;
}): boolean {
  const kept = [row.personal, row.personalSalt, row.personalSubjectId];
  if (kept.every((value) => value === null)) return true;
  if (kept.some((value) => value === null) || row.personalCommitment === null) return false;
  const expected = personalCommitment(row.personalSalt!, row.personalSubjectId!, row.personal!);
  return expected === row.personalCommitment;
}

/**
 * Erase one person's personal fields from every audit event that holds
 * them. Returns how many events were changed. The trigger on the table
 * allows exactly this update and nothing else.
 */
export async function eraseAuditPersonalData(db: Executor, subjectId: string): Promise<number> {
  const rows = await db
    .update(auditEvents)
    .set({ personal: null, personalSalt: null, personalSubjectId: null })
    .where(eq(auditEvents.personalSubjectId, subjectId.toLowerCase()))
    .returning({ id: auditEvents.id });
  return rows.length;
}

/** How many events hold a person's personal fields, for a dry run. */
export async function countAuditPersonalData(db: Executor, subjectId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditEvents)
    .where(eq(auditEvents.personalSubjectId, subjectId.toLowerCase()));
  return row?.n ?? 0;
}
