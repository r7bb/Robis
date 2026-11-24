import {
  cycles,
  type Database,
  issues,
  notify,
  projects,
  users,
  workspaceMembers,
} from '@robis/database';
import { addDays, canonicalZone, wallOf } from '@robis/shared';
import { log } from '@robis/telemetry/log';
import { and, eq, gte, lte, notInArray, sql } from 'drizzle-orm';

/** The hour, on the cycle's own clock, from which the day before its end is said. */
export const CYCLE_ENDING_HOUR = 9;

/** The job that looks for cycles ending tomorrow. */
export const CYCLE_ENDING_JOB = 'cycles.ending';

const pad = (n: number) => String(n).padStart(2, '0');
const dayOf = (wall: { year: number; month: number; day: number }) =>
  `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`;

/** Whether, at `now` on its zone's clock, a cycle ending `endsOn` ends tomorrow and the morning has come. */
export function endsTomorrow(endsOn: string, zone: string, now: Date): boolean {
  const wall = wallOf(now, zone);
  return endsOn === dayOf(addDays(wall, 1)) && wall.hour >= CYCLE_ENDING_HOUR;
}

/** Each person (not an agent, still a member) with work open in the cycle, and how much. */
async function openByAssignee(db: Database, workspaceId: string, cycleId: string) {
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
        eq(issues.cycleId, cycleId),
        notInArray(issues.status, ['DONE', 'CANCELED']),
        eq(users.kind, 'human'),
      ),
    )
    .groupBy(issues.assigneeId);
}

type Ending = {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  endsOn: string;
  projectName: string;
};

/** Tell each person with work open in one cycle, once for this end date. */
async function tellAbout(db: Database, cycle: Ending) {
  const people = await openByAssignee(db, cycle.workspaceId, cycle.id);
  await notify(
    db,
    people.flatMap(({ userId, open }) =>
      userId
        ? [
            {
              userId,
              workspaceId: cycle.workspaceId,
              actorId: null,
              kind: 'cycle_ending',
              entityType: 'cycle',
              entityId: cycle.id,
              // The end date is in the key: a cycle moved to end later is told again.
              dedupeKey: `cycle_ending:${cycle.id}:${cycle.endsOn}`,
              payload: {
                cycleId: cycle.id,
                projectId: cycle.projectId,
                title: cycle.name,
                body: `${openLine(open)} still open on ${cycle.projectName}.`,
              },
            },
          ]
        : [],
    ),
  );
}

/**
 * The day before a cycle's last day, from nine in the morning where it was
 * planned, everyone with an issue still open in it hears that it ends
 * tomorrow and how many of theirs are open. A cycle on an archived board
 * tells nobody. Each pass in that window asks again, so someone given work
 * in it later that day still hears, and the dedupe key (the cycle and its
 * end date) has each person told once. One cycle that fails is logged and
 * the rest still go.
 */
export async function runCycleEndingScan(db: Database, now: Date = new Date()) {
  const today = now.toISOString().slice(0, 10);
  // Every zone's tomorrow is within a day of UTC's: look that wide, then decide in each zone.
  const near = await db
    .select({
      id: cycles.id,
      workspaceId: cycles.workspaceId,
      projectId: cycles.projectId,
      name: cycles.name,
      endsOn: cycles.endsOn,
      timeZone: cycles.timeZone,
      projectName: projects.name,
    })
    .from(cycles)
    .innerJoin(projects, eq(projects.id, cycles.projectId))
    .where(
      and(
        eq(projects.archived, false),
        gte(cycles.endsOn, today),
        lte(cycles.endsOn, addDaysTo(today, 2)),
      ),
    );

  const due = near.filter((c) => endsTomorrow(c.endsOn, canonicalZone(c.timeZone) ?? 'UTC', now));
  for (const cycle of due) {
    try {
      await tellAbout(db, cycle);
    } catch (error) {
      log.error('cycles.ending: one cycle failed; the rest go on', {
        err: error,
        cycleId: cycle.id,
      });
    }
  }
}

/** "One of your issues is", "3 of your issues are". */
const openLine = (open: number) =>
  open === 1 ? 'One of your issues is' : `${open} of your issues are`;

function addDaysTo(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
