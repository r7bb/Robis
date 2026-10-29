import { createHash, randomBytes } from 'node:crypto';
import { eraseAuditPersonalData } from './audit-redaction.ts';
import type { Executor } from './index.ts';
import { erasures } from './schema.ts';
import { eraseUsernameHistory } from './usernames.ts';

export type ErasureResult = {
  auditEventsErased: number;
  usernamesForgotten: number;
  /** SHA-256 of `robis-erasure|<subject id>|<nonce>`, as stored. */
  commitment: string;
  /** For the operator to keep with the request; never stored. */
  nonce: string;
};

/**
 * Erase one person (stage 1, item 9), all in one transaction: blank their
 * personal fields in the audit trail, forget their former usernames (the
 * holds stay, naming nobody), and record the erasure as counts and a
 * commitment. Run as `audit:erase`'s own role, the only one that may.
 * DRAFT FOR LEGAL REVIEW, as the erasure design is.
 */
export async function eraseSubject(
  db: Executor & { transaction: <T>(run: (tx: Executor) => Promise<T>) => Promise<T> },
  subjectId: string,
): Promise<ErasureResult> {
  const id = subjectId.toLowerCase();
  const nonce = randomBytes(32).toString('hex');
  const commitment = createHash('sha256').update(`robis-erasure|${id}|${nonce}`).digest('hex');
  return db.transaction(async (tx) => {
    const auditEventsErased = await eraseAuditPersonalData(tx, id);
    const usernamesForgotten = await eraseUsernameHistory(tx, id);
    await tx.insert(erasures).values({ commitment, auditEventsErased, usernamesForgotten });
    return { auditEventsErased, usernamesForgotten, commitment, nonce };
  });
}
