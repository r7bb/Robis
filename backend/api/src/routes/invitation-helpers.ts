import {
  type Database,
  notifications,
  type Tx,
  users,
  workspaceInvitations,
  workspaceMembers,
} from '@robis/database';
import { can, isUuid, rankOf } from '@robis/shared';
import { and, eq, or, type SQL, sql } from 'drizzle-orm';

/**
 * The pieces the invitation routes share: who an invitation is for, finding
 * one, closing one, and whether its sender still stands behind it.
 *
 * An invitation is addressed to a person (by username) or to an address
 * (by email). An address matches an account only through that account's
 * confirmed email: an unconfirmed address is a claim anyone can type, and
 * it must not reveal which workspaces have invited it.
 */

export const invitationNotice = (invitationId: string) => `invitation:${invitationId}`;

/** The signed-in person, as invitations are addressed: id, and confirmed email if any. */
export type Addressee = { id: string; confirmedEmail: string | null };

export async function addresseeOf(db: Database | Tx, userId: string): Promise<Addressee> {
  const [row] = await db
    .select({ email: users.email, verifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return { id: userId, confirmedEmail: row?.verifiedAt ? row.email : null };
}

/** Invitations meant for this person: by their account, or their confirmed address. */
export function addressedTo(addressee: Addressee): SQL {
  return addressee.confirmedEmail
    ? or(
        eq(workspaceInvitations.userId, addressee.id),
        eq(workspaceInvitations.email, addressee.confirmedEmail),
      )!
    : eq(workspaceInvitations.userId, addressee.id);
}

/** The invitation, if it is addressed to this person; otherwise nothing. */
export async function findMine(db: Database | Tx, invitationId: string, addressee: Addressee) {
  if (!isUuid(invitationId)) return null;
  const [row] = await db
    .select()
    .from(workspaceInvitations)
    .where(and(eq(workspaceInvitations.id, invitationId), addressedTo(addressee)))
    .limit(1);
  return row ?? null;
}

/**
 * Remove an answered or withdrawn invitation, and the notice that announced
 * it. Scoped to whose it is, so a wrong id deletes nothing. The notice is
 * found by its key, which carries the invitation's own random id.
 */
export async function closeInvitation(
  tx: Tx,
  invitationId: string,
  scope: { addressee: Addressee } | { workspaceId: string },
) {
  const [closed] = await tx
    .delete(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.id, invitationId),
        'addressee' in scope
          ? addressedTo(scope.addressee)
          : eq(workspaceInvitations.workspaceId, scope.workspaceId),
      ),
    )
    .returning();
  if (closed) {
    await tx.delete(notifications).where(eq(notifications.dedupeKey, invitationNotice(closed.id)));
  }
  return closed ?? null;
}

/**
 * After joining, any other invitation to the same workspace for the same
 * person (one by username and one by email, say) has nothing left to ask.
 */
export async function closeTheRest(tx: Tx, workspaceId: string, addressee: Addressee) {
  const rest = await tx
    .delete(workspaceInvitations)
    .where(and(eq(workspaceInvitations.workspaceId, workspaceId), addressedTo(addressee)))
    .returning({ id: workspaceInvitations.id });
  for (const { id } of rest) {
    await tx.delete(notifications).where(eq(notifications.dedupeKey, invitationNotice(id)));
  }
}

/**
 * Whether the person who sent an invitation could still send it: still a
 * member, still allowed to invite, and still ranked at least as high as
 * the role offered. An invitation is only as good as its sender's word.
 */
export async function senderStillStands(
  tx: Tx,
  invitation: typeof workspaceInvitations.$inferSelect,
) {
  if (!invitation.invitedBy) return false;
  const [sender] = await tx
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, invitation.workspaceId),
        eq(workspaceMembers.userId, invitation.invitedBy),
      ),
    )
    .limit(1);
  return (
    Boolean(sender) &&
    can(sender!.role, 'member:invite') &&
    rankOf(invitation.role) <= rankOf(sender!.role)
  );
}

export async function usernameOf(db: Database | Tx, userId: string | null) {
  if (!userId) return null;
  const [row] = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.username ?? null;
}

/** Whether a member of this workspace already has this address on their account. */
export async function memberHasEmail(tx: Tx, workspaceId: string, email: string) {
  const [row] = await tx
    .select({ one: sql<number>`1` })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(users.email, email)))
    .limit(1);
  return Boolean(row);
}

/** The account, if any, whose confirmed address this is: for an inbox notice. */
export async function confirmedAccountFor(tx: Tx, email: string) {
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), sql`${users.emailVerifiedAt} is not null`))
    .limit(1);
  return row?.id ?? null;
}
