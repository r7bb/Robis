import { isUuid, type Role } from '@robis/shared';
import { type AnyColumn, and, eq, inArray, isNotNull, notExists, sql } from 'drizzle-orm';
import type { Executor } from './index.ts';
import { twoFactor, workspaceMembers, workspaces } from './schema.ts';

/**
 * The membership lookup behind every authorization decision.
 *
 * It lives here rather than in the API because the WebSocket gateway needs the
 * identical check on connect, and two copies of an authorization query is how
 * they drift apart.
 *
 * Returns null for a syntactically invalid id: Postgres raises a cast error on
 * a malformed uuid, and a bad id cannot name a workspace you belong to anyway.
 */
/** Whether a workspace requires two-factor sign-in of its people (C4). */
export async function requiresTwoFactor(db: Executor, workspaceId: string): Promise<boolean> {
  if (!isUuid(workspaceId)) return false;
  const [row] = await db
    .select({ required: workspaces.requireTwoFactor })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row?.required ?? false;
}

/**
 * A filter for rows across workspaces (C4): none from a workspace that
 * requires two-factor, for someone without it. A row with no workspace
 * passes. Used where a person's things from every workspace are listed.
 */
export function outsideTwoFactorWorkspaces(db: Executor, workspaceId: AnyColumn) {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.requireTwoFactor, true))),
  );
}

/**
 * The workspaces someone runs, as owner or admin, that require two-factor
 * (C4): turning their own off there would lock the workspace's settings
 * away from them.
 */
export async function twoFactorWorkspacesRunBy(db: Executor, userId: string): Promise<string[]> {
  const rows = await db
    .select({ name: workspaces.name })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        inArray(workspaceMembers.role, ['OWNER', 'ADMIN']),
        eq(workspaces.requireTwoFactor, true),
      ),
    )
    .orderBy(workspaces.name);
  return rows.map((row) => row.name);
}

/**
 * Whether a notice from this workspace is held back from this person (C4):
 * it requires two-factor and they have none. Asked again as mail or a push
 * goes, since either may have changed since the notice was made.
 */
export async function heldByTwoFactor(
  db: Executor,
  userId: string,
  workspaceId: string | null,
): Promise<boolean> {
  if (!workspaceId || !(await requiresTwoFactor(db, workspaceId))) return false;
  return !(await withTwoFactor(db, [userId])).has(userId);
}

/** Of these people, those with two-factor on (C4). */
export async function withTwoFactor(
  db: Executor,
  userIds: readonly string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await db
    .select({ userId: twoFactor.userId })
    .from(twoFactor)
    .where(and(inArray(twoFactor.userId, [...userIds]), isNotNull(twoFactor.confirmedAt)));
  return new Set(rows.map((row) => row.userId));
}

export async function findMembership(
  db: Executor,
  workspaceId: string,
  userId: string,
): Promise<{ role: Role } | null> {
  if (!isUuid(workspaceId)) return null;

  const [member] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);

  return member ?? null;
}
