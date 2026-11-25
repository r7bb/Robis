import { type Database, issues, notify, releases } from '@robis/database';
import { log } from '@robis/telemetry/log';
import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import { isTomorrowMorning, nearDays, openByAssignee, openLine } from './day-before.ts';

/** The job that looks for releases due tomorrow. */
export const RELEASE_DUE_JOB = 'releases.due';

type Due = { id: string; workspaceId: string; name: string; targetOn: string };

/** Tell each person with work open in one release, once for this day. */
async function tellAbout(db: Database, release: Due) {
  const people = await openByAssignee(db, release.workspaceId, eq(issues.releaseId, release.id));
  await notify(
    db,
    people.flatMap(({ userId, open }) =>
      userId
        ? [
            {
              userId,
              workspaceId: release.workspaceId,
              actorId: null,
              kind: 'release_due',
              entityType: 'release',
              entityId: release.id,
              // The day is in the key: a release moved later is told again.
              dedupeKey: `release_due:${release.id}:${release.targetOn}`,
              payload: {
                releaseId: release.id,
                title: release.name,
                body: `${openLine(open)} still open in it.`,
              },
            },
          ]
        : [],
    ),
  );
}

/**
 * The day before a release's day, from nine in the morning where it was
 * planned, everyone with an issue still open in it hears that it is due
 * tomorrow and how many of theirs are open. A shipped release, or one with
 * no day, tells nobody. As with cycles, each pass in that window asks
 * again and the dedupe key tells each person once; one that fails is
 * logged and the rest still go.
 */
export async function runReleaseDueScan(db: Database, now: Date = new Date()) {
  const { from, to } = nearDays(now);
  const near = await db
    .select({
      id: releases.id,
      workspaceId: releases.workspaceId,
      name: releases.name,
      targetOn: releases.targetOn,
      timeZone: releases.timeZone,
    })
    .from(releases)
    .where(
      and(isNull(releases.shippedAt), gte(releases.targetOn, from), lte(releases.targetOn, to)),
    );

  for (const release of near) {
    if (!release.targetOn || !isTomorrowMorning(release.targetOn, release.timeZone, now)) continue;
    try {
      await tellAbout(db, { ...release, targetOn: release.targetOn });
    } catch (error) {
      log.error('releases.due: one release failed; the rest go on', {
        err: error,
        releaseId: release.id,
      });
    }
  }
}
