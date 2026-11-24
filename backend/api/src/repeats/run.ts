import {
  type Database,
  enqueue,
  projects,
  publishEvent,
  REPEATS_JOB,
  recurringIssues,
  scheduleRecurring,
  users,
  workspaceMembers,
} from '@robis/database';
import { nextRunAfter, type RepeatCadence } from '@robis/shared';
import { and, eq, lte } from 'drizzle-orm';
import { fileIssue } from '../routes/issues.ts';

/** How often the API looks for repeats that are due. */
export const REPEATS_EVERY_MS = 5 * 60_000;
/** Filed at most in one look: the rest wait for the next. */
const DUE_PER_PASS = 20;

type Due = typeof recurringIssues.$inferSelect;

/** Why a repeat cannot run now: its board archived or gone, its person left. */
async function blockedReason(db: Database, repeat: Due): Promise<string | null> {
  const [project] = await db
    .select({ archived: projects.archived })
    .from(projects)
    .where(eq(projects.id, repeat.projectId));
  if (!project || project.archived) return 'board archived';
  const [member] = await db
    .select({ id: workspaceMembers.userId })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, repeat.workspaceId),
        eq(workspaceMembers.userId, repeat.createdBy),
      ),
    );
  return member ? null : 'creator left';
}

const ruleOf = (repeat: Due) => ({
  cadence: repeat.cadence as RepeatCadence,
  weekday: repeat.weekday,
  monthDay: repeat.monthDay,
  hour: repeat.hour,
  timeZone: repeat.timeZone,
});

/**
 * File one due repeat, and move it on to its next run, in one transaction
 * that claims it first: two passes at once never file it twice. A repeat
 * whose board was archived, or whose person left, is paused instead.
 */
async function runOne(db: Database, repeatId: string, now: Date) {
  const filed = await db.transaction(async (tx) => {
    const [repeat] = await tx
      .select()
      .from(recurringIssues)
      .where(
        and(
          eq(recurringIssues.id, repeatId),
          eq(recurringIssues.paused, false),
          lte(recurringIssues.nextRunAt, now),
        ),
      )
      .for('update', { skipLocked: true });
    if (!repeat) return null;
    if (await blockedReason(db, repeat)) {
      await tx
        .update(recurringIssues)
        .set({ paused: true })
        .where(eq(recurringIssues.id, repeat.id));
      return null;
    }
    const issue = await fileIssue(
      tx,
      // Recorded as the repeat acting, on its creator's behalf.
      { id: repeat.id, kind: 'rule', requestId: null },
      {
        user: { id: repeat.createdBy, kind: 'human' },
        workspaceId: repeat.workspaceId,
        projectId: repeat.projectId,
        input: {
          title: repeat.title,
          ...(repeat.description ? { description: repeat.description } : {}),
          status: 'TODO',
          priority: repeat.priority,
          assigneeId: repeat.assigneeId ?? undefined,
        },
      },
    );
    await tx
      .update(recurringIssues)
      .set({ lastRunAt: now, nextRunAt: nextRunAfter(ruleOf(repeat), now) })
      .where(eq(recurringIssues.id, repeat.id));
    return { issue, repeat };
  });
  if (!filed) return;
  await publishEvent(db, {
    type: 'issue.created',
    workspaceId: filed.repeat.workspaceId,
    projectId: filed.repeat.projectId,
    issueId: filed.issue.id,
    actorId: filed.repeat.createdBy,
  });
}

/** File every repeat due now, then look again in a few minutes. */
export async function runDueRepeats(db: Database, now: Date = new Date()): Promise<number> {
  const due = await db
    .select({ id: recurringIssues.id })
    .from(recurringIssues)
    .where(and(eq(recurringIssues.paused, false), lte(recurringIssues.nextRunAt, now)))
    .orderBy(recurringIssues.nextRunAt)
    .limit(DUE_PER_PASS);
  for (const { id } of due) await runOne(db, id, now);
  return due.length;
}

/**
 * The repeats job's handler: a pass, then the next look queued. A failed
 * pass is logged, not thrown: a retried job would queue a second next look,
 * and the chain would split in two.
 */
export function repeatsHandler(
  db: Database,
  log: { error: (fields: object, message: string) => void },
) {
  return async () => {
    try {
      await runDueRepeats(db);
    } catch (error) {
      log.error({ err: error }, 'repeats: a pass failed; trying again at the next');
    }
    await enqueue(db, REPEATS_JOB, {}, { delayMs: REPEATS_EVERY_MS });
  };
}

/** One chain of looks, however often the API restarts. */
export async function scheduleRepeats(db: Database) {
  await scheduleRecurring(db, [{ kind: REPEATS_JOB, delayMs: REPEATS_EVERY_MS }]);
}
