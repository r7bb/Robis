import { cycles, type Database, issues, notify, projects } from '@robis/database';
import { log } from '@robis/telemetry/log';
import { and, eq, gte, lte } from 'drizzle-orm';
import { isTomorrowMorning, nearDays, openByAssignee, openLine } from './day-before.ts';

/** The job that looks for cycles ending tomorrow. */
export const CYCLE_ENDING_JOB = 'cycles.ending';

/** Whether, at `now` on its zone's clock, a cycle ending `endsOn` ends tomorrow and the morning has come. */
export const endsTomorrow = isTomorrowMorning;

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
  const people = await openByAssignee(db, cycle.workspaceId, eq(issues.cycleId, cycle.id));
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
  const { from, to } = nearDays(now);
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
    .where(and(eq(projects.archived, false), gte(cycles.endsOn, from), lte(cycles.endsOn, to)));

  for (const cycle of near.filter((c) => isTomorrowMorning(c.endsOn, c.timeZone, now))) {
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
