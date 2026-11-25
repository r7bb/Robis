import { cycles, issues } from '@robis/database';
import { sql } from 'drizzle-orm';

/** Statuses an issue is finished in, and so stays with the cycle it was done in. */
export const FINISHED = ['DONE', 'CANCELED'] as const;

/**
 * A cycle and how its issues stand, to select with the issues left-joined
 * on `issues.cycle_id` and grouped by the cycle.
 */
export const CYCLE_COUNTS = {
  id: cycles.id,
  projectId: cycles.projectId,
  name: cycles.name,
  startsOn: cycles.startsOn,
  endsOn: cycles.endsOn,
  total: sql<number>`count(${issues.id})::int`,
  done: sql<number>`(count(${issues.id}) filter (where ${issues.status} = 'DONE'))::int`,
  canceled: sql<number>`(count(${issues.id}) filter (where ${issues.status} = 'CANCELED'))::int`,
  inProgress: sql<number>`(count(${issues.id}) filter (where ${issues.status} in ('IN_PROGRESS', 'IN_REVIEW')))::int`,
  // Put in after the cycle's first day, on its own calendar: planning on day one is not scope added.
  added: sql<number>`(count(${issues.id}) filter (where ${issues.cycleAddedAt} >= ((${cycles.startsOn} + 1)::timestamp at time zone ${cycles.timeZone})))::int`,
};
