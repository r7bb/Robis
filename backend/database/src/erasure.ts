import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { eraseAuditPersonalData } from './audit-redaction.ts';
import type { Executor } from './index.ts';
import { erasureRequests, erasures } from './schema.ts';
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

/**
 * Carry out the erasures that deleted accounts asked for (stage 1, item
 * 10), as `audit:erase`'s role: each one erased and marked done. Returns
 * how many it did. The app files requests but cannot do this itself.
 */
export async function processErasureRequests(
  db: Executor & { transaction: <T>(run: (tx: Executor) => Promise<T>) => Promise<T> },
): Promise<number> {
  const pending = await db
    .select({ id: erasureRequests.id, subjectId: erasureRequests.subjectId })
    .from(erasureRequests)
    .where(isNull(erasureRequests.processedAt));
  for (const request of pending) {
    await eraseSubject(db, request.subjectId);
    await db
      .update(erasureRequests)
      .set({ processedAt: new Date() })
      .where(and(eq(erasureRequests.id, request.id), isNull(erasureRequests.processedAt)));
  }
  return pending.length;
}
