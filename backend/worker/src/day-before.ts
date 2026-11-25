import { type Database, issues, users, workspaceMembers } from '@robis/database';
import { addDays, canonicalZone, wallOf } from '@robis/shared';
import { and, eq, notInArray, type SQL, sql } from 'drizzle-orm';

/**
 * What the day-before notices share (a cycle ending, a release due): when
 * "tomorrow" is, on the clock of whoever planned it, and who has work still
 * open in it.
 */

/** The hour, on the planner's own clock, from which the day before is said. */
const DAY_BEFORE_HOUR = 9;

const pad = (n: number) => String(n).padStart(2, '0');
const dayOf = (wall: { year: number; month: number; day: number }) =>
  `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`;

/**
 * Whether, at `now` on `zone`'s clock (UTC if not a zone), `day` is tomorrow
 * and the morning has come.
 */
export function isTomorrowMorning(day: string, zone: string, now: Date): boolean {
  const wall = wallOf(now, canonicalZone(zone) ?? 'UTC');
  return day === dayOf(addDays(wall, 1)) && wall.hour >= DAY_BEFORE_HOUR;
}

/** Every zone's tomorrow lies in these UTC days: look that wide, then decide in each zone. */
export function nearDays(now: Date): { from: string; to: string } {
  const today = now.toISOString().slice(0, 10);
  const to = new Date(Date.parse(`${today}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
  return { from: today, to };
}

/**
 * Each person (not an agent, still a member) with issues still open among
 * those `inIt` picks, and how many.
 */
export async function openByAssignee(db: Database, workspaceId: string, inIt: SQL) {
  return db
    .select({ userId: issues.assigneeId, open: sql<number>`count(*)::int` })
    .from(issues)
    .innerJoin(users, eq(users.id, issues.assigneeId))
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.userId, users.id), eq(workspaceMembers.workspaceId, workspaceId)),
    )
    .where(
      and(
        eq(issues.workspaceId, workspaceId),
        inIt,
        notInArray(issues.status, ['DONE', 'CANCELED']),
        eq(users.kind, 'human'),
      ),
    )
    .groupBy(issues.assigneeId);
}

/** "One of your issues is", "3 of your issues are". */
export const openLine = (open: number) =>
  open === 1 ? 'One of your issues is' : `${open} of your issues are`;
