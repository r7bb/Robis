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
import { can, nextRunAfter, type RepeatCadence, type Role } from '@robis/shared';
import { and, eq, lte } from 'drizzle-orm';
import { fileIssue } from '../routes/issues.ts';

/** How often the API looks for repeats that are due. */
export const REPEATS_EVERY_MS = 5 * 60_000;
/** Filed at most in one look: the rest wait for the next. */
const DUE_PER_PASS = 20;

type Due = typeof recurringIssues.$inferSelect;

/** Whether someone is still in the workspace, and with what role. */
async function roleIn(db: Database, workspaceId: string, userId: string) {
  const [member] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  return member?.role ?? null;
}

/**
 * Why a repeat cannot run now: its board archived or gone, its person left
 * or no longer allowed to file issues here.
 */
async function blockedReason(db: Database, repeat: Due): Promise<string | null> {
  const [project] = await db
    .select({ archived: projects.archived })
    .from(projects)
    .where(eq(projects.id, repeat.projectId));
  if (!project || project.archived) return 'board archived';
  const role = await roleIn(db, repeat.workspaceId, repeat.createdBy);
  if (!role) return 'creator left';
  return can(role as Role, 'issue:create') ? null : 'creator may not file issues';
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
    const assignee =
      repeat.assigneeId && (await roleIn(db, repeat.workspaceId, repeat.assigneeId))
        ? repeat.assigneeId
        : null;
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
          // Someone who has since left is not given it.
          assigneeId: assignee ?? undefined,
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

/**
 * One that failed to file is moved on to its next run, so it cannot hold
 * up every repeat behind it on each pass.
 */
async function moveOn(db: Database, repeatId: string, now: Date) {
  const [repeat] = await db.select().from(recurringIssues).where(eq(recurringIssues.id, repeatId));
  if (!repeat) return;
  await db
    .update(recurringIssues)
    .set({ nextRunAt: nextRunAfter(ruleOf(repeat), now) })
    .where(eq(recurringIssues.id, repeat.id));
}

/** File every repeat due now; one that fails is reported and moved on. Returns how many were due. */
export async function runDueRepeats(
  db: Database,
  now: Date = new Date(),
  onFailure: (repeatId: string, error: unknown) => void = () => {},
): Promise<number> {
  const due = await db
    .select({ id: recurringIssues.id })
    .from(recurringIssues)
    .where(and(eq(recurringIssues.paused, false), lte(recurringIssues.nextRunAt, now)))
    .orderBy(recurringIssues.nextRunAt)
    .limit(DUE_PER_PASS);
  for (const { id } of due) {
    try {
      await runOne(db, id, now);
    } catch (error) {
      onFailure(id, error);
      await moveOn(db, id, now);
    }
  }
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
      await runDueRepeats(db, new Date(), (repeatId, error) =>
        log.error({ err: error, repeatId }, 'repeats: one failed to file; moved to its next run'),
      );
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
